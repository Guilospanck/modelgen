import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import * as lib from "../engine/lib";
import * as sdf from "../engine/sdf";
import * as anatomy from "../engine/anatomy";
import * as overlay from "../engine/overlay";
import { OpError, type Part } from "../document";
import type { EnginePart, TextureSpec } from "../engine/types";

// Handed to every script builder: build(params, kit).
export const kit = { lib, sdf, anatomy, overlay };

export type ScriptOutput = { parts: EnginePart[]; textures: Record<string, TextureSpec> };

export function runScript(part: Part, baseDir: string): ScriptOutput {
  const spec = part.script!;
  const file = resolve(baseDir, spec.module);
  const fail = (message: string, hint?: string) =>
    new OpError(message, [{ severity: "error", code: "script", part: part.name, message, ...(hint ? { hint } : {}) }]);
  if (!existsSync(file)) throw fail(`${part.name}: script not found: ${file}`, "script.module is relative to the model file");

  // Fresh load every time: drop cached modules from the script's directory tree
  // (not node_modules), so a long-running server sees edits to the script and its helpers.
  // Node keys require.cache by real path (e.g. macOS /var -> /private/var), so match on that.
  const real = realpathSync(file);
  const req = createRequire(real);
  const root = dirname(real) + sep;
  for (const key of Object.keys(req.cache)) if (key.startsWith(root) && !key.includes(`${sep}node_modules${sep}`)) delete req.cache[key];

  let mod: any;
  try { mod = req(real); } catch (e) { throw fail(`${part.name}: ${spec.module} failed to load: ${(e as Error).message}`); }
  const build = typeof mod === "function" ? mod : typeof mod?.default === "function" ? mod.default : typeof mod?.build === "function" ? mod.build : undefined;
  if (!build) throw fail(`${part.name}: ${spec.module} must export a build function`, "module.exports = function build(params, kit) { return { parts, textures } }");

  let out: any;
  try { out = build(spec.params ?? {}, kit); } catch (e) { throw fail(`${part.name}: build threw: ${(e as Error).message}`); }
  if (!out || !Array.isArray(out.parts)) throw fail(`${part.name}: build must return { parts: [...], textures? }`);
  const textures: Record<string, TextureSpec> = out.textures ?? {};
  out.parts.forEach((p: any, i: number) => {
    if (!p || !p.mesh || !Array.isArray(p.mesh.pos) || !Array.isArray(p.mesh.idx)) throw fail(`${part.name}: parts[${i}] has no mesh`);
    if (typeof p.color !== "string" || !/^#[0-9a-f]{6}$/i.test(p.color)) throw fail(`${part.name}: parts[${i}] has a bad color ${JSON.stringify(p.color)}`);
    if (p.tex && !textures[p.tex]) throw fail(`${part.name}: parts[${i}] references missing texture "${p.tex}"`);
  });
  return { parts: out.parts, textures };
}
