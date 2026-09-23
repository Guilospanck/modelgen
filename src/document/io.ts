import * as YAML from "yaml";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { DocSchema, SHAPE_KEYS, type ModelDoc, type Part } from "./schema";
import { OpError } from "./issues";
import { validateDocument } from "./validate";

export function parseModelText(text: string, file: string): unknown {
  if (file.endsWith(".json")) {
    try { return JSON.parse(text); } catch (e) {
      throw new OpError(`${file}: invalid JSON`, [{ severity: "error", code: "parse", path: file, message: `${file}: ${(e as Error).message}`, hint: "fix the JSON syntax" }]);
    }
  }
  const d = YAML.parseDocument(text);
  if (d.errors.length) {
    throw new OpError(`${file}: invalid YAML`, d.errors.map(er => ({
      severity: "error" as const, code: "parse", path: file,
      message: `${file}:${er.linePos?.[0]?.line ?? "?"}: ${er.message.split("\n")[0]}`,
      hint: "fix the YAML syntax (indentation, colons, brackets)",
    })));
  }
  return d.toJS();
}

const TOP = ["modelgen", "name", "units", "normalize", "materials", "parts", "anchors", "life"];
const PART = ["name", ...SHAPE_KEYS, "position", "rotation", "scale", "material", "visible", "surface", "bump"];

function ordered<T extends object>(o: T, keys: readonly string[]): T {
  const src = o as Record<string, unknown>, out: Record<string, unknown> = {};
  for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
  for (const k of Object.keys(src)) if (!(k in out) && src[k] !== undefined) out[k] = src[k];
  return out as T;
}

function canonicalPart(p: Part): Part {
  const q = ordered(p, PART);
  if (q.group) q.group = { parts: q.group.parts.map(canonicalPart) };
  return q;
}

// Stable key order so saved files diff cleanly.
export function canonical(doc: ModelDoc): ModelDoc {
  const d = ordered(doc, TOP);
  d.parts = d.parts.map(canonicalPart);
  return d;
}

export function stringifyModel(doc: ModelDoc, file: string): string {
  const c = canonical(doc);
  if (file.endsWith(".json")) return JSON.stringify(c, null, 2) + "\n";
  const d = new YAML.Document(c);
  // numbers and number pairs/triples stay on one line: position: [0, 1, 0]
  YAML.visit(d, {
    Seq(_, node) {
      if (node.items.every(i => YAML.isScalar(i) || (YAML.isSeq(i) && i.items.every(YAML.isScalar)))) node.flow = true;
    },
  });
  return d.toString({ lineWidth: 0, flowCollectionPadding: false });
}

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

export function modelJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(DocSchema) as Record<string, unknown>;
}
