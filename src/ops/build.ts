import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Issue, ModelDoc } from "../document";
import { flatten, type Compiled, type FlatPart } from "../scene/compile";
import { exportModelFiles, modelAnchors, modelLife, type Anchor } from "../export/model";
import { listModelNames, requireModelFile, selectModels, type Workspace } from "./workspace";
import { compileFor, internalError, opError, readModel } from "./load";
import { markExported } from "./list";

type Loaded = { doc: ModelDoc; compiled: Compiled; flat: FlatPart[]; anchors?: Record<string, Anchor>; life?: { plan: string; metal: string } };
const sortKeys = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function readAggregate(path: string): Record<string, unknown> {
  let data: unknown;
  try { data = JSON.parse(readFileSync(path, "utf8")); } catch (e) { data = e; }
  if (data && typeof data === "object" && !Array.isArray(data) && !(data instanceof Error)) return data as Record<string, unknown>;
  throw opError("io", `${path} is not a JSON object`, "fix or delete it, then run a full build to regenerate it");
}

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
      // A life program that won't compile fails the model: nothing is written or aggregated for it.
      if (life?.problems.length) fail(name, life.problems.map(p => ({ severity: "error", code: "life", message: p })));
      else v = { doc, compiled, flat, anchors, life: life?.entry };
    } catch (e) {
      fail(name, internalError(e).issues);
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
      mkdirSync(dirname(path), { recursive: true });
      const merged = subset && existsSync(path) ? { ...readAggregate(path), ...entries } : entries;
      writeFileSync(path, indent ? JSON.stringify(sortKeys(merged), null, indent) : JSON.stringify(sortKeys(merged)));
      return path;
    };
    return { dir, files, anchors: aggregate(o.anchors, anchors, 1), life: aggregate(o.life, life) };
  });
  return { outputs: results.map(r => Object.fromEntries(Object.entries(r).filter(([, v]) => v !== undefined))) as { dir: string; files: string[]; anchors?: string; life?: string }[], failed };
}
