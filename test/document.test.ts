import { test, expect } from "bun:test";
import { validateDocument, parseModelText, stringifyModel, canonical, modelJsonSchema, OpError } from "../src/document";
import type { ModelDoc } from "../src/document";

const lantern: ModelDoc = {
  modelgen: 1,
  name: "lantern",
  materials: { paper: { color: "#e8a13a", texture: { pattern: "stripes", color: "#c4761f", scale: 6 } }, iron: { color: "#2a2a2a", metalness: 0.8 } },
  parts: [
    { name: "body", lathe: { profile: [[0, 0], [0.25, 0.1], [0.3, 0.5], [0, 0.95]] }, material: "paper" },
    { name: "top", group: { parts: [{ name: "handle", tube: { path: [[-0.1, 0.95, 0], [0, 1.1, 0], [0.1, 0.95, 0]], radius: 0.015 }, material: "iron" }] } },
  ],
};
const withParts = (parts: unknown[], extra: object = {}) => ({ modelgen: 1, name: "t", materials: { m: { color: "#ffffff" } }, parts, ...extra });
const messages = (raw: unknown) => validateDocument(raw).issues.map(i => i.message);

test("a valid document has no issues", () => {
  const r = validateDocument(lantern);
  expect(r.issues).toEqual([]);
  expect(r.doc?.name).toBe("lantern");
});

test("unknown keys are reported with their path", () => {
  const r = validateDocument(withParts([{ name: "a", box: { size: [1, 1, 1] }, colour: "#fff" }]));
  expect(r.doc).toBeUndefined();
  expect(r.issues[0].path).toBe("parts[0]");
  expect(r.issues[0].message).toContain('unknown key "colour"');
  expect(r.issues[0].hint).toBeDefined();
});

test("shape count, names, materials and tube radii are checked", () => {
  expect(messages(withParts([{ name: "a" }]))).toEqual(["parts[0]: has no shape"]);
  expect(messages(withParts([{ name: "a", box: { size: [1, 1, 1] }, sphere: { radius: 1 } }]))[0]).toContain("more than one shape (box, sphere)");
  expect(messages(withParts([{ name: "a", box: { size: [1, 1, 1] } }, { name: "g", group: { parts: [{ name: "a", box: { size: [1, 1, 1] } }] } }]))[0])
    .toBe('parts[1].group.parts[0].name: "a" is already used at parts[0]');
  const unknown = validateDocument(withParts([{ name: "a", box: { size: [1, 1, 1] }, material: "wood" }])).issues[0];
  expect(unknown.message).toBe('parts[0].material: unknown material "wood"');
  expect(unknown.hint).toContain("m");
  expect(messages(withParts([{ name: "a", tube: { path: [[0, 0, 0], [0, 1, 0]] } }]))).toEqual(["parts[0].tube: needs radius or radii"]);
  expect(messages(withParts([{ name: "a", tube: { path: [[0, 0, 0], [0, 1, 0]], radii: [0.1] } }]))[0]).toContain("has 1 entries but path has 2 points");
});

test("schema-level problems: colors, names, sizes, life needs normalize", () => {
  expect(messages({ ...withParts([]), materials: { m: { color: "red" } } })[0]).toContain("materials.m.color");
  expect(messages({ ...withParts([]), name: "My Model" })[0]).toContain("name");
  expect(messages(withParts([{ name: "a", box: { size: [1, 0, 1] } }]))[0]).toContain("parts[0].box.size[1]");
  expect(messages(withParts([{ name: "a", box: { size: [1, 1, 1] } }], { life: { plan: "quad" } }))).toEqual(["life: needs normalize: true"]);
});

test("YAML syntax errors become parse issues with a line number", () => {
  try {
    parseModelText("modelgen: 1\nparts: [\n  - name: x\n", "broken.model.yaml");
    throw new Error("should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(OpError);
    expect((e as OpError).issues[0].code).toBe("parse");
    expect((e as OpError).issues[0].message).toMatch(/broken\.model\.yaml:\d+:/);
  }
});

test("YAML output is canonical, compact and round-trips", () => {
  const shuffled = { parts: [{ material: "paper", position: [0, 1, 0], name: "b", box: { size: [1, 1, 1] } }], name: "x", modelgen: 1, materials: { paper: { color: "#ffffff" } } } as unknown as ModelDoc;
  const text = stringifyModel(shuffled, "x.model.yaml");
  expect(text.startsWith("modelgen: 1\nname: x\n")).toBe(true);
  expect(text).toContain("position: [0, 1, 0]");
  expect(text.indexOf("name: b")).toBeLessThan(text.indexOf("box:"));
  expect(parseModelText(text, "x.model.yaml")).toEqual(canonical(shuffled));
  expect(JSON.parse(stringifyModel(shuffled, "x.model.json"))).toEqual(canonical(shuffled));
});

test("JSON Schema is generated and covers nested groups", () => {
  const s = JSON.stringify(modelJsonSchema());
  expect(s).toContain('"$schema"');
  expect(s).toContain('"group"');
  expect(s).toContain('"lathe"');
});

test("union errors get a hint that matches the field", () => {
  const issue = (raw: unknown) => validateDocument(raw).issues[0];
  const cyl = issue(withParts([{ name: "a", cylinder: { radius: "x", height: 1 } }]));
  expect(cyl.path).toBe("parts[0].cylinder.radius");
  expect(cyl.hint).toContain("[number, number]");
  expect(cyl.hint).not.toContain("blob");
  const scale = issue(withParts([{ name: "a", box: { size: [1, 1, 1] }, scale: "big" }]));
  expect(scale.path).toBe("parts[0].scale");
  expect(scale.hint).toContain("[x, y, z]");
  expect(scale.hint).not.toContain("blob");
  const blob = issue(withParts([{ name: "a", blob: { shapes: [{ cube: { size: 1 } }] } }]));
  expect(blob.path).toContain("blob");
  expect(blob.hint).toContain("blob shapes are one of");
});
