import { writeFileSync } from "node:fs";
import { editText } from "../document/source";
import type { Workspace } from "./workspace";
import { recordEdit } from "./history";
import { opError, readModel } from "./load";

export { EditOpSchema, MAX_OPS, type EditOp } from "../document/ops";

// Edits the model's source in place, so the author's comments and formatting survive.
export function editModel(ws: Workspace, input: { model: string; ops: unknown[] }) {
  const { file, text } = readModel(ws, input.model);
  const { text: after, changes, applied } = editText(text, input.ops, { allowScripts: ws.allowScripts, json: file.endsWith(".json") });
  try { writeFileSync(file, after); } catch (e) { throw opError("io", `can't write ${file}: ${(e as Error).message}`); }
  recordEdit(ws, input.model, text, after);
  return { model: input.model, path: file, applied, changes };
}
