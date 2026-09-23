import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileModel, flatten, findNode, subtreeNames } from "../src/scene/compile";
import { assemble } from "../src/engine/lib";
import type { ModelDoc } from "../src/document";
import type { FlatPart } from "../src/scene/compile";

const base = { baseDir: tmpdir() };
const doc = (parts: ModelDoc["parts"], materials: ModelDoc["materials"] = {}): ModelDoc => ({ modelgen: 1, name: "t", materials, parts });
const bounds = (flat: FlatPart[], owner?: string) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const f of flat) if (!owner || f.owner === owner) for (const v of f.part.mesh.pos) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
  return { mn, mx, centre: [0, 1, 2].map(k => (mn[k] + mx[k]) / 2) };
};

test("positions a primitive", () => {
  const flat = flatten(compileModel(doc([{ name: "b", box: { size: [1, 1, 1] }, position: [1, 0, 0] }]), base).nodes);
  expect(bounds(flat).mn[0]).toBeCloseTo(0.5); expect(bounds(flat).mx[0]).toBeCloseTo(1.5);
});

test("nested groups compose transforms; names with spaces and unicode work", () => {
  const d = doc([{ name: "Outer group ☀", rotation: [0, Math.PI / 2, 0], group: { parts: [
    { name: "inner", position: [1, 0, 0], group: { parts: [{ name: "Lamp body 🔥", box: { size: [0.2, 0.2, 0.2] } }] } },
  ] } }]);
  const c = compileModel(d, base);
  const flat = flatten(c.nodes);
  expect(flat[0].owner).toBe("Lamp body 🔥");
  const ctr = bounds(flat).centre;
  expect(ctr[0]).toBeCloseTo(0); expect(ctr[2]).toBeCloseTo(-1);
  expect(subtreeNames(findNode(c.nodes, "Outer group ☀")!)).toEqual(["Outer group ☀", "inner", "Lamp body 🔥"]);
});

test("materials map to engine parts and textures", () => {
  const c = compileModel(doc([{ name: "b", sphere: { radius: 1 }, material: "paper" }, { name: "c", sphere: { radius: 1 } }],
    { paper: { color: "#e8a13a", roughness: 0.8, texture: { pattern: "stripes", color: "#c4761f", scale: 6 } } }), base);
  const [b, cc] = flatten(c.nodes);
  expect(b.part).toMatchObject({ color: "#e8a13a", tex: "paper", rough: 0.8 });
  expect(cc.part.color).toBe("#b0b0b0");
  expect(c.textures.paper).toEqual({ base: "#e8a13a", pattern: "stripes", patternColor: "#c4761f", freq: 6 });
});

test("hidden parts are skipped; blobs carry normals; tubes take one radius", () => {
  const c = compileModel(doc([
    { name: "hidden", box: { size: [1, 1, 1] }, visible: false },
    { name: "blob", blob: { shapes: [{ sphere: { center: [0, 0, 0], radius: 0.3 } }, { sphere: { center: [0.4, 0, 0], radius: 0.2 } }] } },
    { name: "tube", tube: { path: [[0, 0, 0], [0, 1, 0]], radius: 0.05 } },
  ]), base);
  const flat = flatten(c.nodes);
  expect(flat.map(f => f.owner)).toEqual(["blob", "tube"]);
  expect(flat[0].part.mesh.nrm?.length).toBe(flat[0].part.mesh.pos.length);
  expect(bounds(flat, "tube").mx[0]).toBeCloseTo(0.05, 2);
});

test("mirrored parts keep outward normals", () => {
  const flat = flatten(compileModel(doc([{ name: "s", sphere: { radius: 1 }, scale: [-1, 1, 1] }]), base).nodes);
  const [g] = assemble(flat.map(f => f.part), { raw: true });
  let sum = 0;
  g.pos.forEach((p: number[], i: number) => { sum += p[0] * g.nrm[i][0] + p[1] * g.nrm[i][1] + p[2] * g.nrm[i][2]; });
  expect(sum / g.pos.length).toBeGreaterThan(0.9);
});

test("script parts at identity keep their parts untouched (Mythos compatibility)", () => {
  const d = mkdtempSync(join(tmpdir(), "modelgen-compile-"));
  writeFileSync(join(d, "s.js"), `const p = (kit) => kit.lib.part(kit.lib.uvSphere(), "#ffffff", { tex: "skin" });
module.exports = (params, kit) => ({ parts: [p(kit)], textures: { skin: { base: "#ffffff", pattern: "fur" } } });`);
  const c = compileModel(doc([{ name: "creature", script: { module: "s.js" } }]), { baseDir: d });
  const [f] = flatten(c.nodes);
  expect(f.owner).toBe("creature");
  expect(c.textures.skin.pattern).toBe("fur");
  expect(f.part.mesh.pos[0]).toEqual([0, 1, 0]);
});

test("a script texture id that collides with a material name is an error", () => {
  const d = mkdtempSync(join(tmpdir(), "modelgen-compile-"));
  writeFileSync(join(d, "s.js"), `module.exports = (p, kit) => ({ parts: [kit.lib.part(kit.lib.uvSphere(), "#ffffff", { tex: "paper" })], textures: { paper: { base: "#ffffff" } } });`);
  expect(() => compileModel(doc([{ name: "x", script: { module: "s.js" } }], { paper: { color: "#ffffff", texture: { pattern: "fur" } } }), { baseDir: d }))
    .toThrow(/texture "paper"/);
});
