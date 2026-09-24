// Browser entry: model text in, GLB/USDZ bytes out. No filesystem, no script parts.
// Engine code uses Node's Buffer and zlib; the web build (scripts/build-web.ts) supplies both.
import { OpError, type Issue } from "./document/issues";
import { parseModelText } from "./document/text";
import { validateDocument } from "./document/validate";
import { compileTree } from "./scene/tree";
import { exportModelFiles, FORMATS, type ExportedFile, type Format } from "./export/model";

export { VERSION } from "./version";
export { FORMATS, type ExportedFile, type Format, type Issue };

export type BuildResult = { name?: string; files: ExportedFile[]; issues: Issue[] };

// Never throws for a bad model: parse, schema, script and geometry problems all come back as issues.
export function buildModel(text: string, opts: { formats?: Format[]; json?: boolean } = {}): BuildResult {
  try {
    const { doc, issues } = validateDocument(parseModelText(text, opts.json ? "model.json" : "model.yaml"));
    if (!doc) return { files: [], issues };
    const out = exportModelFiles(doc, compileTree(doc), opts.formats ?? ["glb", "usdz"]);
    return { name: doc.name, files: out.files, issues: [...issues, ...out.issues] };
  } catch (e) {
    if (e instanceof OpError) return { files: [], issues: e.issues };
    throw e;
  }
}
