import { mkdirSync, writeFileSync } from "node:fs";
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

  const { file, doc } = readModel(ws, input.model);
  const compiled = compileFor(file, doc);
  const { files, issues } = exportModelFiles(doc, compiled, formats, { part: input.part });
  if (!files.length) throw new OpError(`${doc.name} can't be exported`, issues);

  mkdirSync(out, { recursive: true });
  const base = `${doc.name}${input.part !== undefined ? "." + slug(input.part) : ""}`;
  const written: { path: string; format: string; bytes: number }[] = files.map(f => {
    const path = join(out, `${base}.${f.format}`);
    writeFileSync(path, f.data);
    return { path, format: f.format, bytes: f.data.length };
  });
  if (input.part === undefined) {
    const flat = flatten(compiled.nodes);
    const anchors = modelAnchors(doc, flat);
    if (anchors) {
      const path = join(out, `${base}.anchors.json`);
      writeFileSync(path, JSON.stringify(anchors, null, 1));
      written.push({ path, format: "anchors", bytes: JSON.stringify(anchors, null, 1).length });
    }
    const life = modelLife(doc, flat, anchors);
    if (life) {
      if (life.problems.length) throw new OpError(`${doc.name}: life program won't compile`, life.problems.map(p => ({ severity: "error" as const, code: "life", message: p })));
      const path = join(out, `${base}.life.json`);
      writeFileSync(path, JSON.stringify(life.entry));
      written.push({ path, format: "life", bytes: JSON.stringify(life.entry).length });
    }
  }
  markExported(ws, doc.name);
  return { model: doc.name, files: written, issues };
}
