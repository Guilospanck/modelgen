import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { OpError, parseModelText, validateDocument, type ModelDoc } from "../document";
import { compileModel, type Compiled } from "../scene/compile";
import { requireModelFile, type Workspace } from "./workspace";
import { syncHandEdits } from "./history";

export const opError = (code: string, message: string, hint?: string) =>
  new OpError(message, [{ severity: "error", code, message, ...(hint ? { hint } : {}) }]);

// Reads a model, recording any hand edit as an undo step first (even a broken one).
export function readModel(ws: Workspace, name: string): { file: string; text: string; doc: ModelDoc } {
  const file = requireModelFile(ws, name);
  const text = readFileSync(file, "utf8");
  syncHandEdits(ws, name, text);
  const { doc, issues } = validateDocument(parseModelText(text, file));
  if (!doc) throw new OpError(`${name} is not a valid model`, issues);
  return { file, text, doc };
}

export const compileFor = (file: string, doc: ModelDoc): Compiled => compileModel(doc, { baseDir: dirname(file) });

export const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_");
