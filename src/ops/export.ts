import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OpError } from "../document";
import { flatten } from "../scene/compile";
import { exportModelFiles, modelAnchors, modelLife, FORMATS, type Format } from "../export/model";
import type { Workspace } from "./workspace";
import { compileFor, opError, readModel, slug } from "./load";
import { markExported } from "./list";

export function exportModel(ws: Workspace, input: { model: string; formats?: Format[]; out?: string; part?: string }) {
  const formats = input.formats?.length ? input.formats : ["glb" as Format];
  const bad = formats.filter(f => !FORMATS.includes(f));
  if (bad.length) throw opError("invalid_format", `unknown format ${bad.join(", ")}`, `formats: ${FORMATS.join(", ")}`);
  if (!input.out) throw opError("missing_out", "no output directory", "pass out (CLI: --out <dir>)");
  const out = resolve(ws.root, input.out);
  if (existsSync(out) && !statSync(out).isDirectory()) throw opError("io", `${out} is not a directory`, "pass a directory for out");

  const { file, doc } = readModel(ws, input.model);
  const compiled = compileFor(file, doc);
  const { files, issues } = exportModelFiles(doc, compiled, formats, { part: input.part });
  if (!files.length) throw new OpError(`${doc.name} can't be exported`, issues);

  // Everything that can fail runs before the first write, so a failed export leaves no files behind.
  const base = `${doc.name}${input.part !== undefined ? "." + slug(input.part) : ""}`;
  const pending: { name: string; format: string; data: Buffer | string }[] = files.map(f => ({ name: `${base}.${f.format}`, format: f.format, data: f.data }));
  if (input.part === undefined) {
    const flat = flatten(compiled.nodes);
    const anchors = modelAnchors(doc, flat);
    const life = modelLife(doc, flat, anchors);
    if (life?.problems.length) throw new OpError(`${doc.name}: life program won't compile`, life.problems.map(p => ({ severity: "error" as const, code: "life", message: p })));
    if (anchors) pending.push({ name: `${base}.anchors.json`, format: "anchors", data: JSON.stringify(anchors, null, 1) });
    if (life) pending.push({ name: `${base}.life.json`, format: "life", data: JSON.stringify(life.entry) });
  }

  let written: { path: string; format: string; bytes: number }[];
  try {
    mkdirSync(out, { recursive: true });
    written = pending.map(f => {
      const path = join(out, f.name);
      writeFileSync(path, f.data);
      return { path, format: f.format, bytes: typeof f.data === "string" ? Buffer.byteLength(f.data) : f.data.length };
    });
  } catch (e) {
    throw opError("io", `can't write to ${out}: ${(e as Error).message}`);
  }
  markExported(ws, doc.name);
  return { model: doc.name, files: written, issues };
}
