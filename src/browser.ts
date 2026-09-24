// Browser entry: model text in, GLB/USDZ bytes out. No filesystem, no script parts.
// Engine code uses Node's Buffer and zlib; the web build (scripts/build-web.ts) supplies both.
import { OpError, type Issue } from "./document/issues";
import { parseModelText } from "./document/text";
import { validateDocument } from "./document/validate";
import { defineMaterials, editText, renameModelText } from "./document/source";
import type { ModelDoc } from "./document/schema";
import { compileTree } from "./scene/tree";
import { exportModelFiles, FORMATS, type ExportedFile, type Format } from "./export/model";

export { VERSION } from "./version";
export { PATTERNS, SHAPE_KEYS } from "./document/schema";
export { FORMATS, type ExportedFile, type Format, type Issue, type ModelDoc };

// Every call here reports problems as issues; only a modelgen bug throws.
function guard<T extends { issues: Issue[] }>(fn: () => T, empty: Omit<T, "issues">): T {
  try { return fn(); } catch (e) {
    if (e instanceof OpError) return { ...empty, issues: e.issues } as T;
    throw e;
  }
}
const fileName = (json?: boolean) => (json ? "model.json" : "model.yaml");

export type ParseResult = { doc?: ModelDoc; issues: Issue[] };
export function parseModel(text: string, opts: { json?: boolean } = {}): ParseResult {
  return guard(() => validateDocument(parseModelText(text, fileName(opts.json))), {});
}

// preview: GLB bytes to look at even when problems (a floating part, say) block the real files.
export type BuildResult = { name?: string; files: ExportedFile[]; preview?: ExportedFile["data"]; issues: Issue[] };

export function buildModel(text: string, opts: { formats?: Format[]; json?: boolean } = {}): BuildResult {
  return guard(() => {
    const { doc, issues } = validateDocument(parseModelText(text, fileName(opts.json)));
    if (!doc) return { files: [], issues };
    const compiled = compileTree(doc);
    const out = exportModelFiles(doc, compiled, opts.formats ?? ["glb", "usdz"]);
    const glb = out.files.find(f => f.format === "glb")?.data
      ?? exportModelFiles(doc, compiled, ["glb"], { ignoreChecks: true }).files[0]?.data;
    return { name: doc.name, files: out.files, preview: glb, issues: [...issues, ...out.issues] };
  }, { files: [] });
}

// Applies edit ops to the source text, keeping its comments and formatting.
export type EditResult = { text?: string; changes: string[]; issues: Issue[] };
export function editModel(text: string, ops: unknown[], opts: { json?: boolean } = {}): EditResult {
  return guard<EditResult>(() => {
    const r = editText(text, ops, { json: opts.json });
    return { text: r.text, changes: r.changes, issues: [] };
  }, { changes: [] });
}

export { defineMaterials };
export { promptFor, followUpFor, parseOpsReply } from "./assistant";

export function renameModel(text: string, name: string): { text?: string; issues: Issue[] } {
  return guard<{ text?: string; issues: Issue[] }>(() => ({ text: renameModelText(text, name), issues: [] }), {});
}
