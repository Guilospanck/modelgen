import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseModelText, validateDocument, type Part } from "../document";
import { listModelNames, modelFile, type Workspace } from "./workspace";

const exportsFile = (ws: Workspace) => join(ws.stateDir, "exports.json");
const countParts = (parts: Part[]): number => parts.reduce((n, p) => n + 1 + (p.group ? countParts(p.group.parts) : 0), 0);

// The export record is a convenience: a missing or corrupt file reads as empty.
function readExported(ws: Workspace): Record<string, string> {
  try {
    const data = JSON.parse(readFileSync(exportsFile(ws), "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

export function markExported(ws: Workspace, model: string) {
  const f = exportsFile(ws);
  const all = readExported(ws);
  all[model] = new Date().toISOString();
  mkdirSync(ws.stateDir, { recursive: true });
  writeFileSync(f, JSON.stringify(all, null, 1));
}

export function listModels(ws: Workspace) {
  const exported = readExported(ws);
  return {
    models: listModelNames(ws).map(name => {
      const path = modelFile(ws, name)!;
      let parts = 0, valid = false;
      try {
        const { doc } = validateDocument(parseModelText(readFileSync(path, "utf8"), path));
        if (doc) { valid = true; parts = countParts(doc.parts); }
      } catch { /* invalid file: listed as valid: false */ }
      return { name, path, parts, valid, ...(exported[name] ? { exportedAt: exported[name] } : {}) };
    }),
  };
}
