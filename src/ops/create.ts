import { writeModelFile, type ModelDoc } from "../document";
import { MODEL_NAME_RE, modelFile, newModelFile, type Workspace } from "./workspace";
import { resetHistory } from "./history";
import { opError, readModel } from "./load";

export function createModel(ws: Workspace, input: { name: string; from?: string }) {
  const { name } = input;
  if (!MODEL_NAME_RE.test(name ?? "")) throw opError("invalid_name", `"${name}" is not a valid model name`, "use lowercase letters, digits, _ and -, e.g. witch_lantern");
  if (modelFile(ws, name)) throw opError("exists", `a model named "${name}" already exists`, "pick another name, or edit the existing model");
  const doc: ModelDoc = input.from ? { ...readModel(ws, input.from).doc, name } : { modelgen: 1, name, materials: {}, parts: [] };
  const path = newModelFile(ws, name);
  resetHistory(ws, name, writeModelFile(path, doc));
  return { model: name, path, document: doc };
}
