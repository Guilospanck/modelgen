import { z } from "zod";
import { OpError, SHAPE_KEYS, validateDocument, writeModelFile, type Material, type ModelDoc, type Part } from "../document";
import type { Workspace } from "./workspace";
import { recordEdit } from "./history";
import { opError, readModel } from "./load";

export const MAX_OPS = 100;
const obj = z.record(z.string(), z.unknown());

export const EditOpSchema = z.union([
  z.object({ add: z.object({ parent: z.string().optional(), part: obj }).strict() }).strict(),
  z.object({ update: z.object({ name: z.string(), set: obj }).strict() }).strict(),
  z.object({ remove: z.object({ name: z.string() }).strict() }).strict(),
  z.object({ rename: z.object({ name: z.string(), to: z.string().min(1) }).strict() }).strict(),
  z.object({ reparent: z.object({ name: z.string(), parent: z.string().nullable() }).strict() }).strict(),
  z.object({ duplicate: z.object({ name: z.string(), as: z.string().min(1), set: obj.optional() }).strict() }).strict(),
  z.object({ set_material: z.object({ name: z.string().min(1), material: obj }).strict() }).strict(),
  z.object({ remove_material: z.object({ name: z.string() }).strict() }).strict(),
  z.object({ set: z.object({ normalize: z.boolean().nullable().optional(), anchors: z.unknown().optional(), life: z.unknown().optional() }).strict() }).strict(),
]);
export type EditOp = z.infer<typeof EditOpSchema>;

type Where = { list: Part[]; index: number; part: Part };

function locate(parts: Part[], name: string): Where | undefined {
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].name === name) return { list: parts, index: i, part: parts[i] };
    const g = parts[i].group;
    if (g) { const hit = locate(g.parts, name); if (hit) return hit; }
  }
  return undefined;
}
const allNames = (parts: Part[]): string[] => parts.flatMap(p => [p.name, ...(p.group ? allNames(p.group.parts) : [])]);
const containsScript = (p: any): boolean => !!p && (p.script !== undefined || (Array.isArray(p.group?.parts) && p.group.parts.some(containsScript)));

function mustFind(doc: ModelDoc, name: string): Where {
  const w = locate(doc.parts, name);
  if (!w) throw opError("not_found", `no part named "${name}"`, `parts: ${allNames(doc.parts).join(", ") || "(none yet)"}`);
  return w;
}

function groupList(doc: ModelDoc, name: string): Part[] {
  const { part } = mustFind(doc, name);
  if (!part.group) throw opError("not_a_group", `"${name}" is not a group`, "only groups can have children; add a group part first");
  return part.group.parts;
}

// Shape objects merge when the shape stays the same; a new shape key replaces the old one; null unsets.
function merge(part: Part, set: Record<string, unknown>) {
  const p = part as Record<string, unknown>;
  for (const [k, v] of Object.entries(set)) {
    if (k === "name") throw opError("use_rename", "can't change a name with update", "use the rename op");
    if (k === "group") throw opError("use_add", "can't replace a group's children with update", "use add, remove and reparent");
    if (v === null) { delete p[k]; continue; }
    if ((SHAPE_KEYS as readonly string[]).includes(k)) {
      if (p[k] !== undefined && typeof p[k] === "object" && typeof v === "object") p[k] = { ...(p[k] as object), ...(v as object) };
      else { for (const s of SHAPE_KEYS) if (s !== "group") delete p[s]; p[k] = v; }
    } else p[k] = v;
  }
}

function applyOp(doc: ModelDoc, op: EditOp, ws: Workspace, changes: string[]) {
  const guard = (x: unknown) => {
    if (!ws.allowScripts && containsScript(x)) throw opError("scripts_disabled", "script parts can only be added or changed when modelgen runs with --allow-scripts", "use regular shapes, or ask the user to restart modelgen with --allow-scripts");
  };
  if ("add" in op) {
    guard(op.add.part);
    const list = op.add.parent !== undefined ? groupList(doc, op.add.parent) : doc.parts;
    list.push(op.add.part as unknown as Part);
    changes.push(`added "${String(op.add.part.name)}"${op.add.parent !== undefined ? ` to "${op.add.parent}"` : ""}`);
  } else if ("update" in op) {
    const { part } = mustFind(doc, op.update.name);
    guard(part); guard(op.update.set);
    merge(part, op.update.set);
    changes.push(`updated "${op.update.name}" (${Object.keys(op.update.set).join(", ")})`);
  } else if ("remove" in op) {
    const w = mustFind(doc, op.remove.name);
    w.list.splice(w.index, 1);
    changes.push(`removed "${op.remove.name}"`);
  } else if ("rename" in op) {
    const { part } = mustFind(doc, op.rename.name);
    if (locate(doc.parts, op.rename.to)) throw opError("exists", `a part named "${op.rename.to}" already exists`);
    part.name = op.rename.to;
    changes.push(`renamed "${op.rename.name}" to "${op.rename.to}"`);
  } else if ("reparent" in op) {
    const w = mustFind(doc, op.reparent.name);
    if (op.reparent.parent !== null) {
      if (op.reparent.parent === op.reparent.name || (w.part.group && locate(w.part.group.parts, op.reparent.parent)))
        throw opError("cycle", `can't move "${op.reparent.name}" inside itself`, "pick a parent outside its subtree");
      groupList(doc, op.reparent.parent);
    }
    w.list.splice(w.index, 1);
    (op.reparent.parent === null ? doc.parts : groupList(doc, op.reparent.parent)).push(w.part);
    changes.push(`moved "${op.reparent.name}" to ${op.reparent.parent === null ? "the top level" : `"${op.reparent.parent}"`}`);
  } else if ("duplicate" in op) {
    const w = mustFind(doc, op.duplicate.name);
    if (locate(doc.parts, op.duplicate.as)) throw opError("exists", `a part named "${op.duplicate.as}" already exists`);
    const copy: Part = structuredClone(w.part);
    const prefix = (ps: Part[]) => ps.forEach(c => { c.name = `${op.duplicate.as}.${c.name}`; if (c.group) prefix(c.group.parts); });
    copy.name = op.duplicate.as;
    if (copy.group) prefix(copy.group.parts);
    if (op.duplicate.set) { guard(op.duplicate.set); merge(copy, op.duplicate.set); }
    w.list.splice(w.index + 1, 0, copy);
    changes.push(`duplicated "${op.duplicate.name}" as "${op.duplicate.as}"`);
  } else if ("set_material" in op) {
    doc.materials = { ...(doc.materials ?? {}), [op.set_material.name]: op.set_material.material as unknown as Material };
    changes.push(`set material "${op.set_material.name}"`);
  } else if ("remove_material" in op) {
    const users: string[] = [];
    const scan = (ps: Part[]) => ps.forEach(p => { if (p.material === op.remove_material.name) users.push(p.name); if (p.group) scan(p.group.parts); });
    scan(doc.parts);
    if (users.length) throw opError("in_use", `material "${op.remove_material.name}" is used by ${users.map(u => `"${u}"`).join(", ")}`, "change those parts' material first");
    if (doc.materials) delete doc.materials[op.remove_material.name];
    changes.push(`removed material "${op.remove_material.name}"`);
  } else if ("set" in op) {
    for (const k of ["normalize", "anchors", "life"] as const) {
      if (!(k in op.set)) continue;
      const v = op.set[k];
      if (v === null) delete (doc as Record<string, unknown>)[k]; else (doc as Record<string, unknown>)[k] = v;
      changes.push(`set ${k}`);
    }
  }
}

export function editModel(ws: Workspace, input: { model: string; ops: unknown[] }) {
  const ops = input.ops;
  if (!Array.isArray(ops) || ops.length === 0) throw opError("invalid_op", "ops must be a non-empty list", "e.g. [{ add: { part: { name: \"base\", box: { size: [1, 0.1, 1] } } } }]");
  if (ops.length > MAX_OPS) throw opError("too_many_ops", `at most ${MAX_OPS} ops per batch (got ${ops.length})`, "split the edit into several batches");
  const parsed = ops.map((op, i) => {
    const r = EditOpSchema.safeParse(op);
    if (!r.success) throw opError("invalid_op", `ops[${i}]: not a valid op`, "each op is one of: add, update, remove, rename, reparent, duplicate, set_material, remove_material, set (`modelgen describe ops`)");
    return structuredClone(r.data); // ops are applied in place; never alias the caller's objects
  });

  const { file, text, doc } = readModel(ws, input.model);
  const next: ModelDoc = structuredClone(doc);
  const changes: string[] = [];
  parsed.forEach((op, i) => {
    try { applyOp(next, op, ws, changes); } catch (e) {
      if (!(e instanceof OpError)) throw e;
      throw new OpError(`ops[${i}]: ${e.message}`, e.issues.map(x => ({ ...x, path: `ops[${i}]`, message: `ops[${i}] (${Object.keys(op)[0]}): ${x.message}` })));
    }
  });
  const { doc: valid, issues } = validateDocument(next);
  if (!valid) throw new OpError("the edit would make the model invalid; nothing was changed", issues);
  const after = writeModelFile(file, valid);
  recordEdit(ws, input.model, text, after);
  return { model: input.model, path: file, applied: parsed.length, changes };
}
