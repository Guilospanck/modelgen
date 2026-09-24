import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as YAML from "yaml";
import { editText } from "../src/document/source";
import { applyEdit } from "../src/document/ops";
import { parseModelText, validateDocument, OpError, type ModelDoc } from "../src/document";

const SRC = `modelgen: 1
name: lamp # the name
# shared finishes
materials:
  iron: {color: "#2a2a2a", metalness: 0.8}
parts:
  # the heavy bit at the bottom
  - name: base
    box: {size: [0.4, 0.06, 0.4]} # 40 cm square
    material: iron

  # glows
  - name: shade
    cylinder: {radius: 0.1, height: 0.3}
    position: [0, 0.18, 0]
  - name: top
    group:
      parts:
        # handle ring
        - name: ring
          torus: {radius: 0.05, tube: 0.01}
          position: [0, 0.36, 0]
`;
const docOf = (text: string) => validateDocument(parseModelText(text, "m.yaml")).doc as ModelDoc;
// What the same edit produces through the canonical path; editText must agree on content.
const expected = (text: string, ops: unknown[]) => applyEdit(docOf(text), ops).doc;
const lines = (s: string) => s.split("\n");
const diff = (a: string, b: string) => {
  const A = new Set(lines(a)), B = new Set(lines(b));
  return { removed: lines(a).filter(l => !B.has(l)), added: lines(b).filter(l => !A.has(l)) };
};

test("every example survives a parse/print round trip byte for byte", () => {
  const dir = join(__dirname, "../examples");
  for (const f of readdirSync(dir).filter(f => f.endsWith(".model.yaml"))) {
    const text = readFileSync(join(dir, f), "utf8");
    const noop = editText(text, [{ update: { name: docOf(text).parts[0].name, set: {} } }], { allowScripts: true });
    expect(noop.text).toBe(text);
  }
});

test("update changes only the edited line and keeps every comment", () => {
  const ops = [{ update: { name: "shade", set: { position: [0, 0.2, 0] } } }];
  const r = editText(SRC, ops);
  expect(diff(SRC, r.text)).toEqual({ removed: ["    position: [0, 0.18, 0]"], added: ["    position: [0, 0.2, 0]"] });
  expect(r.doc).toEqual(expected(SRC, ops));
  expect(r.changes).toEqual(['updated "shade" (position)']);
});

test("a new key lands in canonical order, not at the end", () => {
  const r = editText(SRC, [{ update: { name: "shade", set: { material: "iron", rotation: [0, 1, 0] } } }]);
  const shade = r.text.slice(r.text.indexOf("- name: shade"), r.text.indexOf("- name: top"));
  expect(shade).toBe("- name: shade\n    cylinder: {radius: 0.1, height: 0.3}\n    position: [0, 0.18, 0]\n    rotation: [0, 1, 0]\n    material: iron\n  ");
});

test("changing a part's shape puts the new shape where the old one was", () => {
  const r = editText(SRC, [{ update: { name: "shade", set: { sphere: { radius: 0.1 } } } }]);
  expect(r.text).toContain("  - name: shade\n    sphere: {radius: 0.1}\n    position: [0, 0.18, 0]\n");
});

test("rename, remove and reparent keep the comments that belong to the moved parts", () => {
  const renamed = editText(SRC, [{ rename: { name: "base", to: "plinth" } }]).text;
  expect(renamed).toContain("  # the heavy bit at the bottom\n  - name: plinth\n    box: {size: [0.4, 0.06, 0.4]} # 40 cm square\n");

  const removed = editText(SRC, [{ remove: { name: "shade" } }]).text;
  expect(removed).not.toContain("shade");
  expect(removed).toContain("# the heavy bit at the bottom");
  expect(removed).toContain("# handle ring");

  const ops = [{ reparent: { name: "ring", parent: null } }];
  const moved = editText(SRC, ops);
  expect(moved.text).toContain("# handle ring");
  expect(moved.text).toContain("torus: {radius: 0.05, tube: 0.01}");
  expect(moved.doc).toEqual(expected(SRC, ops));
});

test("added parts and materials follow their neighbours' inline style", () => {
  const ops = [
    { add: { part: { name: "foot", box: { size: [0.1, 0.02, 0.1] }, position: [0, -0.04, 0] } } },
    { set_material: { name: "brass", material: { color: "#b08d3c", metalness: 0.9 } } },
  ];
  const r = editText(SRC, ops);
  expect(r.text).toContain("  - name: foot\n    box: {size: [0.1, 0.02, 0.1]}\n    position: [0, -0.04, 0]\n");
  expect(r.text).toContain('  brass: {color: "#b08d3c", metalness: 0.9}\n');
  expect(r.doc).toEqual(expected(SRC, ops));
  expect(YAML.parse(r.text)).toEqual(JSON.parse(JSON.stringify(r.doc)));
});

test("a document without materials gets them right after the name", () => {
  const src = "modelgen: 1\nname: x\nparts:\n  - name: a\n    box: {size: [1, 1, 1]}\n";
  const r = editText(src, [{ set_material: { name: "m", material: { color: "#ffffff" } } }]);
  expect(r.text.startsWith("modelgen: 1\nname: x\nmaterials:\n")).toBe(true);
});

test("JSON models are edited through the canonical writer", () => {
  const json = JSON.stringify({ modelgen: 1, name: "x", parts: [{ name: "a", box: { size: [1, 1, 1] } }] });
  const r = editText(json, [{ update: { name: "a", set: { position: [0, 1, 0] } } }], { json: true });
  expect(JSON.parse(r.text).parts[0].position).toEqual([0, 1, 0]);
});

test("bad ops and broken documents throw OpError and change nothing", () => {
  expect(() => editText(SRC, [{ remove: { name: "nope" } }])).toThrow(OpError);
  expect(() => editText(SRC, [{ update: { name: "shade", set: { cylinder: { height: -1 } } } }])).toThrow(OpError);
  expect(() => editText("parts: [", [{ remove: { name: "a" } }])).toThrow(OpError);
  expect(() => editText("modelgen: 1\nname: x\nparts: [{name: a, box: {size: 1}}]\n", [{ remove: { name: "a" } }])).toThrow(OpError);
});

test("a renamed material keeps its inline style; groups are always blocks", () => {
  const src = "modelgen: 1\nname: x\nmaterials:\n  glaze: {color: \"#2f6f8f\"}\nparts:\n  - name: a\n    box: {size: [1, 1, 1]}\n    material: glaze\n";
  const renamed = editText(src, [{ set_material: { name: "ceramic", material: { color: "#2f6f8f" } } }, { update: { name: "a", set: { material: "ceramic" } } }, { remove_material: { name: "glaze" } }]);
  expect(renamed.text).toContain('  ceramic: {color: "#2f6f8f"}\n');
  const grouped = editText(src, [{ add: { part: { name: "g", group: { parts: [] } } } }, { reparent: { name: "a", parent: "g" } }]);
  expect(grouped.text).toContain("  - name: g\n    group:\n      parts:\n        - name: a\n          box: {size: [1, 1, 1]}\n");
  // The same move in two steps: an empty group first, then the part dragged into it.
  const empty = editText(src, [{ add: { part: { name: "g", group: { parts: [] } } } }]).text;
  expect(empty).toContain("    group:\n      parts: []\n");
  expect(editText(empty, [{ reparent: { name: "a", parent: "g" } }]).text).toContain("      parts:\n        - name: a\n          box: {size: [1, 1, 1]}\n");
});
