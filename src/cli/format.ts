import { relative } from "node:path";
import type { Issue } from "../document";

const rel = (p: string) => relative(process.cwd(), p) || ".";

export function formatIssues(issues: Issue[]): string {
  return issues.map(i => `${i.severity} ${i.code}${i.part ? ` [${i.part}]` : ""}: ${i.message}${i.hint ? `\n  hint: ${i.hint}` : ""}`).join("\n") + (issues.length ? "\n" : "");
}

function tree(parts: any[], depth = 0): string[] {
  return parts.flatMap(p => [
    `${"  ".repeat(depth)}${p.name}  ${p.shape}${p.material ? `  ${p.material}` : ""}${p.visible ? "" : "  (hidden)"}${p.bounds ? `  [${p.bounds.min.join(", ")}] → [${p.bounds.max.join(", ")}]` : ""}`,
    ...tree(p.children ?? [], depth + 1),
  ]);
}

export function human(command: string, r: any): string {
  switch (command) {
    case "init": return `created ${rel(r.config)} and ${rel(r.models)}/\n`;
    case "new": return `created ${r.model} → ${rel(r.path)}\n`;
    case "list": return r.models.length
      ? r.models.map((m: any) => `${m.name}  ${m.parts} parts${m.valid ? "" : "  (invalid)"}${m.exportedAt ? `  exported ${m.exportedAt}` : ""}`).join("\n") + "\n"
      : "no models yet — create one with: modelgen new <name>\n";
    case "inspect": return [`${r.model}  (${rel(r.path)}, ${r.bytes} bytes${r.normalize ? ", normalized" : ""})`,
      `materials: ${Object.keys(r.materials).join(", ") || "(none)"}`, ...tree(r.parts),
      `history: ${r.history.undo} undo, ${r.history.redo} redo`].join("\n") + "\n";
    case "edit": return r.changes.map((c: string) => `  ${c}`).join("\n") + `\n${r.applied} ops applied to ${r.model}\n`;
    case "undo": case "redo": return `${command} ${r.model}  (${r.undo} undo, ${r.redo} redo left)\n`;
    case "capture": return `wrote ${rel(r.image.path)}  (${r.image.views.length} views, ${r.image.width}×${r.image.height})\n`;
    case "export": return r.files.map((f: any) => `wrote ${rel(f.path)}  (${f.bytes} bytes)`).join("\n") + "\n";
    case "build": return r.outputs.map((o: any) => `${rel(o.dir)}: ${o.files.length} files${o.anchors ? ", anchors" : ""}${o.life ? ", life" : ""}`).join("\n") + "\n"
      + (r.failed.length ? `${r.failed.length} model(s) failed: ${r.failed.map((f: any) => f.model).join(", ")}\n` : "");
    case "describe": return r.text + "\n";
    default: return JSON.stringify(r, null, 2) + "\n";
  }
}
