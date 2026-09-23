import { readFileSync, writeFileSync } from "node:fs";
import type { Workspace } from "./workspace";
import { requireModelFile } from "./workspace";
import { historyDepth, redoStep, syncHandEdits, undoStep } from "./history";

function step(ws: Workspace, model: string, fn: typeof undoStep) {
  const file = requireModelFile(ws, model);
  const text = readFileSync(file, "utf8");
  syncHandEdits(ws, model, text);
  writeFileSync(file, fn(ws, model, text));
  return { model, path: file, ...historyDepth(ws, model) };
}

export const undoModel = (ws: Workspace, input: { model: string }) => step(ws, input.model, undoStep);
export const redoModel = (ws: Workspace, input: { model: string }) => step(ws, input.model, redoStep);
