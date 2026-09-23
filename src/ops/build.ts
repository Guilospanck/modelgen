import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OpError, type Issue, type ModelDoc } from "../document";
import { flatten, type Compiled, type FlatPart } from "../scene/compile";
import { exportModelFiles, modelAnchors, modelLife, type Anchor } from "../export/model";
import { listModelNames, requireModelFile, selectModels, type Workspace } from "./workspace";
import { compileFor, opError, readModel } from "./load";
import { markExported } from "./list";

type Loaded = { doc: ModelDoc; compiled: Compiled; flat: FlatPart[]; anchors?: Record<string, Anchor>; life?: { plan: string; metal: string } };
const sortKeys = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

export function buildProject(ws: Workspace, input: { models?: string[] } = {}) {
  const outputs = ws.config?.outputs;
  if (!outputs?.length) throw opError("no_config", "no outputs configured", "run `modelgen init` and list outputs in modelgen.yaml");
  const all = listModelNames(ws);
  const subset = input.models?.length ? input.models : undefined;
  subset?.forEach(n => requireModelFile(ws, n));
  const wanted = subset ?? all;

  const failed: { model: string; issues: Issue[] }[] = [];
  const fail = (model: string, issues: Issue[]) => { if (!failed.some(f => f.model === model)) failed.push({ model, issues }); };
  const cache = new Map<string, Loaded | null>();
  const load = (name: string): Loaded | null => {
    if (cache.has(name)) return cache.get(name)!;
    let v: Loaded | null = null;
    try {
      const { file, doc } = readModel(ws, name);
      const compiled = compileFor(file, doc);
      const flat = flatten(compiled.nodes);
      const anchors = modelAnchors(doc, flat);
      const life = modelLife(doc, flat, anchors);
      if (life?.problems.length) fail(name, life.problems.map(p => ({ severity: "error", code: "life", message: p })));
      v = { doc, compiled, flat, anchors, life: life?.entry };
    } catch (e) {
      if (!(e instanceof OpError)) throw e;
      fail(name, e.issues);
    }
    cache.set(name, v);
    return v;
  };

  const results = outputs.map(o => {
    const dir = resolve(ws.root, o.dir);
    mkdirSync(dir, { recursive: true });
    const names = selectModels(all, o.models ?? ["*"]).filter(n => wanted.includes(n));
    const files: string[] = [];
    const anchors: Record<string, Record<string, Anchor>> = {}, life: Record<string, { plan: string; metal: string }> = {};
    for (const name of names) {
      const m = load(name);
      if (!m) continue;
      const r = exportModelFiles(m.doc, m.compiled, o.formats);
      if (!r.files.length) { fail(name, r.issues); continue; }
      for (const f of r.files) {
        const path = join(dir, `${o.prefix ?? ""}${name}.${f.format}`);
        writeFileSync(path, f.data);
        files.push(path);
      }
      if (m.anchors) anchors[name] = m.anchors;
      if (m.life) life[name] = m.life;
      markExported(ws, name);
    }
    // Aggregates: a subset build updates only its own entries.
    const aggregate = <T>(rel: string | undefined, entries: Record<string, T>, indent?: number) => {
      if (!rel) return undefined;
      const path = join(dir, rel);
      const merged = subset && existsSync(path) ? { ...JSON.parse(readFileSync(path, "utf8")), ...entries } : entries;
      writeFileSync(path, indent ? JSON.stringify(sortKeys(merged), null, indent) : JSON.stringify(sortKeys(merged)));
      return path;
    };
    return { dir, files, anchors: aggregate(o.anchors, anchors, 1), life: aggregate(o.life, life) };
  });
  return { outputs: results.map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))) as { dir: string; files: string[]; anchors?: string; life?: string }[], failed };
}
