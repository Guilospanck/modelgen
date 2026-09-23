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
  // Outputs are named after doc.name, so a copied file must not write over its original's files.
  if (doc.name !== name) {
    const message = `name: "${doc.name}" doesn't match the file name "${name}"`;
    throw new OpError(`${name} is not a valid model`, [{ severity: "error", code: "schema", path: "name", message, hint: `rename the file or set name: ${name}` }]);
  }
  return { file, text, doc };
}

export const compileFor = (file: string, doc: ModelDoc): Compiled => compileModel(doc, { baseDir: dirname(file) });

// Wraps an unexpected (non-OpError) failure so callers can report it like any other.
export function internalError(e: unknown): OpError {
  if (e instanceof OpError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new OpError(`unexpected error: ${message}`, [{ severity: "error", code: "internal", message, hint: "this is likely a modelgen bug; please report it" }]);
}

export const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_");
