import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as YAML from "yaml";
import { z } from "zod";
import { OpError, formatPath } from "../document";
import { FORMATS, type Format } from "../export/model";

export const CONFIG_FILE = "modelgen.yaml";

export type OutputConfig = { dir: string; formats: Format[]; prefix?: string; models?: string[]; anchors?: string; life?: string };
export type ProjectConfig = { models?: string; previews?: string; outputs?: OutputConfig[] };
export type Workspace = { root: string; modelsDir: string; previewsDir: string; stateDir: string; config?: ProjectConfig; allowScripts: boolean };

const OutputSchema = z.object({
  dir: z.string().min(1),
  formats: z.array(z.enum(FORMATS as [Format, ...Format[]])).min(1),
  prefix: z.string().optional(),
  models: z.array(z.string()).optional(),
  anchors: z.string().optional(),
  life: z.string().optional(),
}).strict();
const ConfigSchema = z.object({ models: z.string().optional(), previews: z.string().optional(), outputs: z.array(OutputSchema).optional() }).strict();

export function openWorkspace(root: string, opts: { allowScripts?: boolean } = {}): Workspace {
  root = resolve(root);
  const file = join(root, CONFIG_FILE);
  let config: ProjectConfig | undefined;
  if (existsSync(file)) {
    const d = YAML.parseDocument(readFileSync(file, "utf8"));
    const fail = (messages: string[]) => new OpError(`${CONFIG_FILE} is invalid`, messages.map(m => ({ severity: "error", code: "config", path: CONFIG_FILE, message: `${CONFIG_FILE}: ${m}`, hint: "see `modelgen describe project`" })));
    if (d.errors.length) throw fail(d.errors.map(e => `line ${e.linePos?.[0]?.line ?? "?"}: ${e.message.split("\n")[0]}`));
    const r = ConfigSchema.safeParse(d.toJS() ?? {});
    if (!r.success) throw fail(r.error.issues.map(i => `${formatPath(i.path)}: ${i.message}`));
    config = r.data as ProjectConfig;
  }
  return {
    root,
    modelsDir: resolve(root, config?.models ?? "models"),
    previewsDir: resolve(root, config?.previews ?? "previews"),
    stateDir: join(root, ".modelgen"),
    config,
    allowScripts: opts.allowScripts ?? false,
  };
}

export function modelFile(ws: Workspace, name: string): string | undefined {
  for (const ext of [".model.yaml", ".model.yml", ".model.json"]) {
    const f = join(ws.modelsDir, name + ext);
    if (existsSync(f)) return f;
  }
  return undefined;
}

export const MODEL_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;

// Model names reach file paths, so anything outside the name grammar is refused before lookup.
export function requireModelFile(ws: Workspace, name: string): string {
  if (typeof name !== "string" || !MODEL_NAME_RE.test(name)) throw new OpError(`"${name}" is not a valid model name`, [{
    severity: "error", code: "invalid_name", message: `"${name}" is not a valid model name`, hint: "use lowercase letters, digits, _ and -",
  }]);
  const f = modelFile(ws, name);
  if (f) return f;
  const known = listModelNames(ws);
  throw new OpError(`no model named "${name}"`, [{
    severity: "error", code: "not_found", message: `no model named "${name}" in ${ws.modelsDir}`,
    hint: known.length ? `existing models: ${known.join(", ")}` : "create one with create_model",
  }]);
}

export const newModelFile = (ws: Workspace, name: string) => join(ws.modelsDir, `${name}.model.yaml`);

export function listModelNames(ws: Workspace): string[] {
  if (!existsSync(ws.modelsDir)) return [];
  const names = new Set<string>();
  for (const f of readdirSync(ws.modelsDir)) {
    const m = f.match(/^(.+)\.model\.(ya?ml|json)$/);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const globRe = (p: string) => new RegExp("^" + p.split("*").map(s => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");

export function selectModels(names: string[], patterns: string[] = ["*"]): string[] {
  const includes = patterns.filter(p => !p.startsWith("!"));
  const include = (includes.length ? includes : ["*"]).map(globRe);
  const exclude = patterns.filter(p => p.startsWith("!")).map(p => globRe(p.slice(1)));
  return names.filter(n => include.some(r => r.test(n)) && !exclude.some(r => r.test(n)));
}

export function configTemplate(): string {
  return [
    "# modelgen project — https://github.com/Guilospanck/modelgen",
    "models: models        # where <name>.model.yaml files live",
    "previews: previews    # where capture writes PNGs",
    "outputs:              # used by `modelgen build`",
    "  - dir: build/models",
    "    formats: [glb, usdz]",
    "    models: [\"*\"]",
    "",
  ].join("\n");
}
