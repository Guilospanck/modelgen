// Edits applied to a model's source text, not to a fresh printout: comments, key order and
// formatting the author chose survive; only what the edit changed is rewritten.
import * as YAML from "yaml";
import { OpError } from "./issues";
import { applyEdit, type EditOptions } from "./ops";
import type { ModelDoc } from "./schema";
import { canonical, flowNumbers, parseModelText, PART_KEYS, stringifyModel, TOP_KEYS, YAML_PRINT } from "./text";
import { validateDocument } from "./validate";

type Plain = null | boolean | number | string | Plain[] | { [k: string]: Plain };
type Ctx = { doc: YAML.Document; pool: Map<string, YAML.YAMLMap>; used: Set<YAML.Node>; names: Set<string> };

const isObj = (v: unknown): v is Record<string, Plain> => !!v && typeof v === "object" && !Array.isArray(v);
const keyOf = (p: YAML.Pair) => (YAML.isScalar(p.key) ? String(p.key.value) : String(p.key));
const partName = (n: unknown) => (YAML.isMap(n) ? n.get("name") : undefined);

const isFlow = (n: unknown) => YAML.isCollection(n) && !!n.flow;
// Groups hold whole parts and are always written as blocks, so they never copy a shape's inline style.
const SHAPES = new Set<string>(PART_KEYS.slice(1, PART_KEYS.indexOf("position")).filter(k => k !== "group"));
const setFlow = (n: unknown) => { if (YAML.isCollection(n)) n.flow = true; };

// New maps copy their neighbours' style: a value is written {inline} when the same key
// (or, for shapes, any shape) is inline in the sibling.
function styleLike(node: YAML.Node, sibling: unknown) {
  if (!YAML.isMap(node) || !YAML.isMap(sibling)) return;
  for (const pair of node.items) {
    const k = keyOf(pair);
    const twin = sibling.items.find(p => keyOf(p) === k || (SHAPES.has(k) && SHAPES.has(keyOf(p))));
    if (twin && isFlow(twin.value)) setFlow(pair.value);
  }
}

// A replacement node keeps the comments, spacing and inline style of the node it replaces.
function fresh(ctx: Ctx, old: unknown, value: Plain): YAML.Node {
  const node = ctx.doc.createNode(value) as YAML.Node;
  flowNumbers(node);
  if (isFlow(old)) setFlow(node);
  if (YAML.isNode(old)) {
    node.commentBefore = old.commentBefore;
    node.comment = old.comment;
    node.spaceBefore = old.spaceBefore;
  }
  return node;
}

// Where a new key goes: before the first existing key that comes after it in canonical order.
function insertPair(map: YAML.YAMLMap, pair: YAML.Pair, order?: string[]) {
  const rank = order?.indexOf(keyOf(pair)) ?? -1;
  const at = rank < 0 ? -1 : map.items.findIndex(p => { const r = order!.indexOf(keyOf(p)); return r > rank; });
  if (at < 0) map.items.push(pair); else map.items.splice(at, 0, pair);
}

function sync(ctx: Ctx, node: unknown, value: Plain, order?: string[], itemOrder?: string[]): YAML.Node {
  if (isObj(value)) {
    if (!YAML.isMap(node)) return fresh(ctx, node, value);
    // Style is judged before removals, so a renamed entry still matches the entry it replaced.
    const inline = node.items.some(p => isFlow(p.value));
    node.items = node.items.filter(p => keyOf(p) in value);
    for (const [k, v] of Object.entries(value)) {
      const pair = node.items.find(p => keyOf(p) === k);
      const childItems = k === "parts" ? PART_KEYS : undefined;
      if (pair) pair.value = sync(ctx, pair.value, v, undefined, childItems);
      else {
        const created = fresh(ctx, undefined, v);
        if (inline && k !== "group") setFlow(created);
        insertPair(node, ctx.doc.createPair(k, created), order);
      }
    }
    return node;
  }
  if (Array.isArray(value)) {
    if (!YAML.isSeq(node)) return fresh(ctx, node, value);
    if (itemOrder === PART_KEYS) {
      node.items = syncParts(ctx, node.items, value);
      if (node.items.length) node.flow = false; // "parts: []" opens up once it has parts
      return node;
    }
    node.items = value.map((v, i) => (i < node.items.length ? sync(ctx, node.items[i], v) : fresh(ctx, undefined, v)));
    return node;
  }
  if (YAML.isScalar(node) && (typeof node.value === typeof value || node.value === null)) {
    if (node.value !== value) node.value = value;
    return node;
  }
  return fresh(ctx, node, value);
}

// Parts are matched by name anywhere in the document (so a reparented part keeps its comments);
// a part whose name vanished pairs with a new name in the same list (a rename).
function syncParts(ctx: Ctx, olds: unknown[], values: Plain[]): YAML.Node[] {
  const named = values.map(v => {
    const n = isObj(v) ? ctx.pool.get(String(v.name)) : undefined;
    if (!n || ctx.used.has(n)) return undefined;
    ctx.used.add(n);
    return n;
  });
  const renamed = olds.filter((n): n is YAML.YAMLMap => YAML.isMap(n) && !ctx.used.has(n) && !ctx.names.has(String(partName(n))));
  return values.map((v, i) => {
    let n: YAML.Node | undefined = named[i];
    if (!n && renamed.length) { n = renamed.shift()!; ctx.used.add(n); }
    if (n) return sync(ctx, n, v, PART_KEYS);
    const created = fresh(ctx, undefined, v);
    styleLike(created, olds.find(YAML.isMap));
    // A new group's children may be existing parts moved into it: reuse their nodes too.
    const kids = YAML.isMap(created) ? created.getIn(["group", "parts"], true) : undefined;
    if (YAML.isSeq(kids) && isObj(v) && isObj(v.group) && Array.isArray(v.group.parts)) kids.items = syncParts(ctx, [], v.group.parts);
    return created;
  });
}

function collectParts(node: unknown, pool: Map<string, YAML.YAMLMap>) {
  if (!YAML.isSeq(node)) return;
  for (const item of node.items) {
    if (!YAML.isMap(item)) continue;
    pool.set(String(item.get("name")), item);
    const group = item.get("group");
    if (YAML.isMap(group)) collectParts(group.get("parts", true), pool);
  }
}
function allNames(parts: ModelDoc["parts"], out = new Set<string>()): Set<string> {
  for (const p of parts) { out.add(p.name); if (p.group) allNames(p.group.parts, out); }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => same(a[k], b[k]));
  }
  return false;
}

export function editText(text: string, ops: unknown, opts: EditOptions & { json?: boolean } = {}): { text: string; doc: ModelDoc; changes: string[]; applied: number } {
  const file = opts.json ? "model.json" : "model.yaml";
  const { doc: before, issues } = validateDocument(parseModelText(text, file));
  if (!before) throw new OpError("the model has problems; fix them before editing", issues);
  const { doc, changes, applied } = applyEdit(before, ops, opts);
  const printed = () => ({ text: stringifyModel(doc, file), doc, changes, applied });
  if (opts.json) return printed();

  const ydoc = YAML.parseDocument(text);
  const pool = new Map<string, YAML.YAMLMap>();
  collectParts((ydoc.contents as YAML.YAMLMap).get("parts", true), pool);
  const ctx: Ctx = { doc: ydoc, pool, used: new Set(), names: allNames(doc.parts) };
  // canonical() orders keys of anything new; existing maps keep the author's order.
  ydoc.contents = sync(ctx, ydoc.contents, JSON.parse(JSON.stringify(canonical(doc))), TOP_KEYS) as typeof ydoc.contents;
  // Backstop: if the patched source doesn't say exactly what the edit produced, print it fresh.
  if (!same(ydoc.toJS(), JSON.parse(JSON.stringify(doc)))) return printed();
  return { text: ydoc.toString(YAML_PRINT), doc, changes, applied };
}

// Defines materials that parts use but nobody declared: the quick fix for "unknown material".
// Works on text that doesn't validate yet (that's the point), keeping comments.
export function defineMaterials(text: string, names: string[], color = "#c8c2b4"): string {
  const ydoc = YAML.parseDocument(text);
  if (ydoc.errors.length || !YAML.isMap(ydoc.contents)) return text;
  const top = ydoc.contents as YAML.YAMLMap<unknown, unknown>;
  const found: unknown = top.get("materials", true);
  let map: YAML.YAMLMap;
  if (YAML.isMap(found)) map = found;
  else {
    map = ydoc.createNode({}) as YAML.YAMLMap;
    if (top.has("materials")) top.set("materials", map); // "materials:" with nothing under it
    else insertPair(top, ydoc.createPair("materials", map), TOP_KEYS);
  }
  const inline = !map.items.length || map.items.some(p => isFlow(p.value));
  for (const name of names) {
    if (map.has(name)) continue;
    const node = ydoc.createNode({ color }) as YAML.Node;
    if (inline) setFlow(node);
    map.items.push(ydoc.createPair(name, node));
  }
  return ydoc.toString(YAML_PRINT);
}

export const MODEL_NAME = /^[a-z0-9][a-z0-9_-]*$/;

// Renames the model (its top-level name), keeping comments. There's no edit op for this: outputs
// are named after the model, so the CLI renames by renaming the file; the playground has no file.
export function renameModelText(text: string, name: string): string {
  if (!MODEL_NAME.test(name)) {
    const message = `"${name}" can't be a model name`;
    throw new OpError(message, [{ severity: "error", code: "invalid_name", path: "name", message, hint: "use lowercase letters, digits, _ and - (starting with a letter or digit)" }]);
  }
  const ydoc = YAML.parseDocument(text);
  if (ydoc.errors.length || !YAML.isMap(ydoc.contents)) throw new OpError("the model has problems; fix them before renaming it");
  const top = ydoc.contents as YAML.YAMLMap<unknown, unknown>;
  const node = top.get("name", true);
  if (YAML.isScalar(node)) node.value = name;
  else insertPair(top, ydoc.createPair("name", name), TOP_KEYS);
  return ydoc.toString(YAML_PRINT);
}
