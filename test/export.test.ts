import { test, expect } from "bun:test";
import { tmpdir } from "node:os";
import { compileModel, flatten } from "../src/scene/compile";
import { exportModelFiles, modelAnchors, modelLife } from "../src/export/model";
import { glbJson, validateGlb } from "../src/export/glb";
import { readUsda, parseUsdaPoints, validateUsdz } from "../src/export/usdz";
import type { ModelDoc } from "../src/document";

const doc = (extra: Partial<ModelDoc> = {}): ModelDoc => ({
  modelgen: 1, name: "lamp",
  materials: { iron: { color: "#2a2a2a", metalness: 0.8 }, paper: { color: "#e8a13a", texture: { pattern: "stripes" } } },
  parts: [
    { name: "base", box: { size: [1, 0.4, 1] }, material: "iron" },
    { name: "Top ☀", position: [0, 0.6, 0], group: { parts: [
      { name: "shade", cylinder: { radius: 0.4, height: 1 }, material: "paper" },
    ] } },
  ],
  ...extra,
});
const compiled = (d: ModelDoc) => compileModel(d, { baseDir: tmpdir() });
const extent = (pts: number[][]) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of pts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
  return { mn, mx };
};

test("usdz and glb export, valid, with a named hierarchy", () => {
  const d = doc();
  const { files, issues } = exportModelFiles(d, compiled(d), ["usdz", "glb"]);
  expect(issues).toEqual([]);
  const usdz = files.find(f => f.format === "usdz")!.data, glb = files.find(f => f.format === "glb")!.data;
  expect(validateUsdz(usdz)).toEqual([]);
  expect(validateGlb(glb)).toEqual([]);
  const j = glbJson(glb);
  expect(j.nodes[j.scenes[0].nodes[0]].name).toBe("lamp");
  const top = j.nodes.find((n: any) => n.name === "Top ☀");
  expect(top.translation).toEqual([0, 0.6, 0]);
  expect(j.nodes[top.children[0]].name).toBe("shade");
  expect(j.images.length).toBe(2);
});

test("normalize: false keeps authored units; true fits the largest side to 2", () => {
  const raw = doc();
  const pts = parseUsdaPoints(readUsda(exportModelFiles(raw, compiled(raw), ["usdz"]).files[0].data));
  expect(extent(pts).mx[0]).toBeCloseTo(0.5, 2);
  expect(extent(pts).mx[1]).toBeCloseTo(1.1, 2);
  const n = doc({ normalize: true });
  const pn = parseUsdaPoints(readUsda(exportModelFiles(n, compiled(n), ["usdz"]).files[0].data));
  const e = extent(pn);
  expect(Math.max(e.mx[0] - e.mn[0], e.mx[1] - e.mn[1], e.mx[2] - e.mn[2])).toBeCloseTo(2, 2);
  const j = glbJson(exportModelFiles(n, compiled(n), ["glb"]).files[0].data);
  expect(j.nodes[0].scale[0]).toBeGreaterThan(0);
});

test("exporting one part keeps its local transform and only its subtree", () => {
  const d = doc();
  const { files, issues } = exportModelFiles(d, compiled(d), ["glb", "usdz"], { part: "Top ☀" });
  expect(issues).toEqual([]);
  const j = glbJson(files[0].data);
  expect(j.nodes[j.scenes[0].nodes[0]]).toMatchObject({ name: "Top ☀", translation: [0, 0.6, 0] });
  expect(j.nodes.some((n: any) => n.name === "base")).toBe(false);
  expect(extent(parseUsdaPoints(readUsda(files[1].data))).mn[1]).toBeCloseTo(0.1, 2);
});

test("errors block export and are returned as issues", () => {
  const d = doc({ parts: [{ name: "a", sphere: { radius: 0.1 } }, { name: "b", sphere: { radius: 0.1 }, position: [3, 0, 0] }] });
  const r = exportModelFiles(d, compiled(d), ["glb"]);
  expect(r.files).toEqual([]);
  expect(r.issues[0]).toMatchObject({ code: "floating" });
  expect(() => exportModelFiles(d, compiled(d), ["glb"], { part: "nope" })).toThrow(/no part named "nope"/);
});

test("anchors (with overrides) and life programs", () => {
  const d: ModelDoc = {
    modelgen: 1, name: "critter", normalize: true,
    parts: [{ name: "body", blob: { shapes: [{ chain: { points: [[0, 0.5, -0.5], [0, 0.55, 0.3], [0, 0.8, 0.6]], radii: [0.2, 0.25, 0.15] } }] } },
      { name: "legs", group: { parts: [
        { name: "l1", cylinder: { radius: 0.05, height: 0.5 }, position: [0.12, 0.25, 0.2] },
        { name: "l2", cylinder: { radius: 0.05, height: 0.5 }, position: [-0.12, 0.25, 0.2] },
        { name: "l3", cylinder: { radius: 0.05, height: 0.5 }, position: [0.12, 0.25, -0.35] },
        { name: "l4", cylinder: { radius: 0.05, height: 0.5 }, position: [-0.12, 0.25, -0.35] },
      ] } }],
    anchors: { slots: ["head", "back", "tail"], overrides: { tail: { pos: [0, 0.5, -0.7], scale: 0.2 } } },
    life: { plan: "quad", params: { stride: 0.4, gait: 8 } },
  };
  const flat = flatten(compiled(d).nodes);
  const anchors = modelAnchors(d, flat)!;
  expect(anchors.head).toBeDefined();   // headAnchor always finds a crown
  expect(anchors.tail).toBeDefined();   // override
  expect(Object.keys(anchors).every(k => ["head", "back", "tail"].includes(k))).toBe(true);
  for (const a of Object.values(anchors)) for (const c of a.pos) expect(Math.abs(c)).toBeLessThanOrEqual(1.3);
  const life = modelLife(d, flat, anchors)!;
  expect(life.entry.plan).toBe("quad");
  expect(life.entry.metal.length).toBeGreaterThan(100);
  expect(life.problems).toEqual([]);
});
