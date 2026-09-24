import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { ModelDoc } from "./schema";
import { OpError } from "./issues";
import { validateDocument } from "./validate";
import { parseModelText, stringifyModel } from "./text";

export function writeModelFile(file: string, doc: ModelDoc): string {
  const text = stringifyModel(doc, file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return text;
}

// Read + parse + validate; throws OpError with parse or schema issues.
export function loadModelFile(file: string): { text: string; doc: ModelDoc } {
  const text = readFileSync(file, "utf8");
  const { doc, issues } = validateDocument(parseModelText(text, file));
  if (!doc) throw new OpError(`${file} is not a valid model`, issues);
  return { text, doc };
}
