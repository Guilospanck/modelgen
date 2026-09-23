import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspace } from "../src/ops/workspace";
import { createModel } from "../src/ops/create";
import { editModel } from "../src/ops/edit";
import { listModels } from "../src/ops/list";
import { capture } from "../src/ops/capture";
import { exportModel } from "../src/ops/export";
import { buildProject } from "../src/ops/build";
import { describe as describeOp, TOPICS } from "../src/ops/describe";
import { toJson } from "../src/ops";
import { decodePng } from "../src/util/png";
import { OpError } from "../src/document";

const tmp = () => mkdtempSync(join(tmpdir(), "modelgen-out-"));
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as OpError).issues?.[0]?.code ?? String(e); } return "no error"; };
const lantern = (root = tmp()) => {
  const w = openWorkspace(root);
  createModel(w, { name: "lantern" });
  editModel(w, { model: "lantern", ops: [
    { set_material: { name: "paper", material: { color: "#e8a13a", texture: { pattern: "stripes" } } } },
    { add: { part: { name: "body", lathe: { profile: [[0, 0], [0.25, 0.1], [0.3, 0.5], [0, 0.95]] }, material: "paper" } } },
    { add: { part: { name: "handle", tube: { path: [[-0.1, 0.8, 0], [0, 1.1, 0], [0.1, 0.8, 0]], radius: 0.015 } } } }, // ends touch the body
  ] });
  return w;
};

test("capture renders views, part positions and issues", () => {
  const w = lantern();
  const r = capture(w, { model: "lantern", size: 200 });
  expect(existsSync(r.image.path)).toBe(true);
  const png = decodePng(readFileSync(r.image.path));
  expect([png.width, png.height]).toEqual([600, 200]);
  expect(r.parts.map(p => p.name)).toEqual(["body", "handle"]);
  for (const p of r.parts) for (const v of p.views) expect(v.inFrame).toBe(true);
  expect(r.parts[0].views[1].x).toBeGreaterThan(200);
  expect(r.issues).toEqual([]);
  expect((toJson(r) as any).png).toBeUndefined();
});

test("capture: presets, part filter, floating issue, empty model", () => {
  const w = lantern();
  expect(capture(w, { model: "lantern", views: "turntable", size: 100 }).image.views).toHaveLength(8);
  expect(capture(w, { model: "lantern", part: "handle", size: 100 }).parts.map(p => p.name)).toEqual(["handle"]);
  editModel(w, { model: "lantern", ops: [{ update: { name: "handle", set: { position: [2, 0, 0] } } }] });
  expect(capture(w, { model: "lantern", size: 100 }).issues[0]).toMatchObject({ code: "floating", part: "handle" });
  createModel(w, { name: "empty" });
  expect(code(() => capture(w, { model: "empty" }))).toBe("empty");
  expect(code(() => capture(w, { model: "lantern", views: "sideways" }))).toBe("invalid_views");
});

test("export writes files, needs --out, refuses broken models", () => {
  const w = lantern(), out = join(w.root, "dist");
  const r = exportModel(w, { model: "lantern", formats: ["glb", "usdz"], out });
  expect(r.files.map(f => f.path)).toEqual([join(out, "lantern.glb"), join(out, "lantern.usdz")]);
  expect(code(() => exportModel(w, { model: "lantern", formats: ["glb"] }))).toBe("missing_out");
  editModel(w, { model: "lantern", ops: [{ update: { name: "handle", set: { position: [2, 0, 0] } } }] });
  expect(code(() => exportModel(w, { model: "lantern", out }))).toBe("floating");
});

test("build writes every output; a subset build keeps other aggregate entries", () => {
  const root = tmp();
  writeFileSync(join(root, "modelgen.yaml"), [
    "outputs:",
    "  - dir: web", "    formats: [glb]",
    "  - dir: ios", "    formats: [usdz]", "    prefix: m_", "    anchors: anchors.json",
  ].join("\n"));
  const w = lantern(root);
  createModel(w, { name: "stool" });
  editModel(w, { model: "stool", ops: [
    { add: { part: { name: "seat", cylinder: { radius: 0.3, height: 0.05 }, position: [0, 0.5, 0] } } },
    { add: { part: { name: "leg", cylinder: { radius: 0.03, height: 0.5 }, position: [0, 0.25, 0] } } },
    { set: { anchors: { slots: ["back"], overrides: { back: { pos: [0, 0.55, 0], scale: 0.3 } } } } },
  ] });
  editModel(w, { model: "lantern", ops: [{ set: { anchors: { slots: ["head"] } } }] });
  const r = buildProject(w);
  expect(r.failed).toEqual([]);
  expect(existsSync(join(root, "web/lantern.glb"))).toBe(true);
  expect(existsSync(join(root, "ios/m_stool.usdz"))).toBe(true);
  const anchorsPath = join(root, "ios/anchors.json");
  expect(Object.keys(JSON.parse(readFileSync(anchorsPath, "utf8")))).toEqual(["lantern", "stool"]);
  editModel(w, { model: "stool", ops: [{ set: { anchors: { slots: ["back"], overrides: { back: { pos: [0, 0.6, 0], scale: 0.3 } } } } }] });
  buildProject(w, { models: ["stool"] });
  const after = JSON.parse(readFileSync(anchorsPath, "utf8"));
  expect(Object.keys(after)).toEqual(["lantern", "stool"]);
  expect(after.stool.back.pos[1]).toBe(0.6);
  expect(code(() => buildProject(w, { models: ["nope"] }))).toBe("not_found");
  expect(code(() => buildProject(openWorkspace(tmp())))).toBe("no_config");
});

test("describe covers every topic and the schema", () => {
  for (const topic of TOPICS) expect(describeOp({ topic }).text.length).toBeGreaterThan(50);
  expect(describeOp({ topic: "schema" }).schema).toBeDefined();
  expect(describeOp().topic).toBe("overview");
  expect(code(() => describeOp({ topic: "kittens" }))).toBe("unknown_topic");
});

// A cetacean's `rate` is spliced into the Metal source, so a non-numeric rate fails the life lint.
const badLife = (w: ReturnType<typeof openWorkspace>, name = "whale") => {
  createModel(w, { name });
  editModel(w, { model: name, ops: [
    { add: { part: { name: "body", sphere: { radius: 0.5 }, position: [0, 0.5, 0] } } },
    { set: { normalize: true, anchors: { slots: ["head"] }, life: { plan: "cetacean", params: { rate: "bogus" } } } },
  ] });
};

test("export writes nothing when the life program fails", () => {
  const w = openWorkspace(tmp()), out = join(w.root, "dist");
  badLife(w);
  expect(code(() => exportModel(w, { model: "whale", out }))).toBe("life");
  expect(existsSync(out) ? readdirSync(out) : []).toEqual([]);
});

test("build skips a model whose life fails and writes nested aggregates", () => {
  const root = tmp();
  writeFileSync(join(root, "modelgen.yaml"), [
    "outputs:",
    "  - dir: ios", "    formats: [glb]", "    anchors: meta/anchors.json", "    life: meta/life.json",
  ].join("\n"));
  const w = lantern(root);
  editModel(w, { model: "lantern", ops: [{ set: { anchors: { slots: ["head"] } } }] });
  badLife(w);
  const r = buildProject(w);
  expect(r.failed.map(f => f.model)).toEqual(["whale"]);
  expect(r.failed[0].issues[0].code).toBe("life");
  expect(existsSync(join(root, "ios/whale.glb"))).toBe(false);
  expect(existsSync(join(root, "ios/lantern.glb"))).toBe(true);
  expect(Object.keys(JSON.parse(readFileSync(join(root, "ios/meta/anchors.json"), "utf8")))).toEqual(["lantern"]);
  expect(JSON.parse(readFileSync(join(root, "ios/meta/life.json"), "utf8"))).toEqual({});
  expect(listModels(w).models.find(m => m.name === "whale")?.exportedAt).toBeUndefined();
});
