export * from "./workspace";
export { createModel } from "./create";
export { listModels } from "./list";
export { inspectModel } from "./inspect";
export { editModel, EditOpSchema, MAX_OPS } from "./edit";
export { undoModel, redoModel } from "./undo";
export { capture, VIEW_PRESETS } from "./capture";
export { exportModel } from "./export";
export { buildProject } from "./build";
export { describe, TOPICS } from "./describe";

// JSON-safe copy of an op result (drops binary fields such as capture's png).
export function toJson(result: unknown): unknown {
  return JSON.parse(JSON.stringify(result, (_k, v) => (v && v.type === "Buffer" && Array.isArray(v.data) ? undefined : v)));
}
