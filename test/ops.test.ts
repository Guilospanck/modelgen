import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspace } from "../src/ops/workspace";
import { createModel } from "../src/ops/create";
import { listModels } from "../src/ops/list";
import { inspectModel } from "../src/ops/inspect";
import { editModel, MAX_OPS } from "../src/ops/edit";
import { undoModel, redoModel } from "../src/ops/undo";
import { historyDepth } from "../src/ops/history";
import { OpError } from "../src/document";

const ws = (allowScripts = false) => openWorkspace(mkdtempSync(join(tmpdir(), "modelgen-ops-")), { allowScripts });
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as OpError).issues?.[0]?.code ?? String(e); } return "no error"; };

const lanternOps = [
  { set_material: { name: "paper", material: { color: "#e8a13a", roughness: 0.8 } } },
  { add: { part: { name: "body", lathe: { profile: [[0, 0], [0.25, 0.1], [0.3, 0.5], [0, 0.95]] }, material: "paper" } } },
  { add: { part: { name: "top", position: [0, 0.95, 0], group: { parts: [] } } } },
  { add: { parent: "top", part: { name: "handle", tube: { path: [[-0.1, 0, 0], [0, 0.15, 0], [0.1, 0, 0]], radius: 0.015 } } } },
];

test("create, list and inspect", () => {
  const w = ws();
  const c = createModel(w, { name: "lantern" });
  expect(c.path).toBe(join(w.modelsDir, "lantern.model.yaml"));
  expect(listModels(w).models).toEqual([{ name: "lantern", path: c.path, parts: 0, valid: true }]);
  editModel(w, { model: "lantern", ops: lanternOps });
  const info = inspectModel(w, { model: "lantern" });
  expect(info.parts.map(p => p.name)).toEqual(["body", "top"]);
  expect(info.parts[1].children![0]).toMatchObject({ name: "handle", shape: "tube" });
  expect(info.parts[1].children![0].bounds!.max[1]).toBeCloseTo(1.1 + 0.015, 2);
  expect(info.materials.paper.color).toBe("#e8a13a");
  expect(inspectModel(w, { model: "lantern", part: "top" }).parts.map(p => p.name)).toEqual(["top"]);
  expect(listModels(w).models[0].parts).toBe(3);
});

test("create validates names, refuses duplicates, copies with from", () => {
  const w = ws();
  expect(code(() => createModel(w, { name: "My Model" }))).toBe("invalid_name");
  createModel(w, { name: "a" });
  expect(code(() => createModel(w, { name: "a" }))).toBe("exists");
  editModel(w, { model: "a", ops: [{ add: { part: { name: "x", box: { size: [1, 1, 1] } } } }] });
  expect(createModel(w, { name: "b", from: "a" }).document.parts[0].name).toBe("x");
});

test("update merges shape fields, switches shapes, null unsets", () => {
  const w = ws();
  createModel(w, { name: "m" });
  editModel(w, { model: "m", ops: [{ add: { part: { name: "t", tube: { path: [[0, 0, 0], [0, 1, 0]], radius: 0.1 }, position: [1, 0, 0] } } }] });
  editModel(w, { model: "m", ops: [{ update: { name: "t", set: { tube: { radius: 0.2 }, position: null } } }] });
  let p = inspectModel(w, { model: "m" }).parts[0];
  expect(p.params).toEqual({ path: [[0, 0, 0], [0, 1, 0]], radius: 0.2 });
  expect(p.position).toBeUndefined();
  editModel(w, { model: "m", ops: [{ update: { name: "t", set: { box: { size: [1, 1, 1] } } } }] });
  p = inspectModel(w, { model: "m" }).parts[0];
  expect(p.shape).toBe("box");
});

test("rename, reparent, cycles, duplicate", () => {
  const w = ws();
  createModel(w, { name: "m" });
  editModel(w, { model: "m", ops: lanternOps });
  editModel(w, { model: "m", ops: [{ rename: { name: "handle", to: "bail" } }, { reparent: { name: "bail", parent: null } }] });
  expect(inspectModel(w, { model: "m" }).parts.map(p => p.name)).toEqual(["body", "top", "bail"]);
  editModel(w, { model: "m", ops: [{ reparent: { name: "bail", parent: "top" } }, { add: { parent: "top", part: { name: "inner", group: { parts: [] } } } }] });
  expect(code(() => editModel(w, { model: "m", ops: [{ reparent: { name: "top", parent: "inner" } }] }))).toBe("cycle");
  editModel(w, { model: "m", ops: [{ duplicate: { name: "top", as: "top2", set: { position: [1, 0.95, 0] } } }] });
  const names = inspectModel(w, { model: "m", part: "top2" }).parts[0].children!.map(c => c.name);
  expect(names).toEqual(["top2.bail", "top2.inner"]);
});

test("materials in use can't be removed", () => {
  const w = ws();
  createModel(w, { name: "m" });
  editModel(w, { model: "m", ops: lanternOps.slice(0, 2) });
  expect(code(() => editModel(w, { model: "m", ops: [{ remove_material: { name: "paper" } }] }))).toBe("in_use");
  editModel(w, { model: "m", ops: [{ remove: { name: "body" } }, { remove_material: { name: "paper" } }] });
  expect(Object.keys(inspectModel(w, { model: "m" }).materials)).toEqual([]);
});

test("a failing batch changes nothing and records no undo step", () => {
  const w = ws();
  const { path } = createModel(w, { name: "m" });
  const before = readFileSync(path, "utf8");
  const e = (() => { try { editModel(w, { model: "m", ops: [{ add: { part: { name: "ok", box: { size: [1, 1, 1] } } } }, { update: { name: "missing", set: {} } }] }); } catch (x) { return x as OpError; } })();
  expect(e!.issues[0].code).toBe("not_found");
  expect(e!.issues[0].message).toStartWith("ops[1]");
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(historyDepth(w, "m").undo).toBe(0);
  expect(code(() => editModel(w, { model: "m", ops: [{ add: { part: { name: "bad", box: { size: [1, -1, 1] } } } }] }))).toBe("schema");
  expect(code(() => editModel(w, { model: "m", ops: Array(MAX_OPS + 1).fill({ remove: { name: "x" } }) }))).toBe("too_many_ops");
  expect(code(() => editModel(w, { model: "m", ops: [{ explode: {} }] }))).toBe("invalid_op");
});

test("script parts need --allow-scripts", () => {
  const add = { add: { part: { name: "s", script: { module: "x.js" } } } };
  const w = ws();
  createModel(w, { name: "m" });
  expect(code(() => editModel(w, { model: "m", ops: [add] }))).toBe("scripts_disabled");
  const w2 = ws(true);
  createModel(w2, { name: "m" });
  expect(code(() => editModel(w2, { model: "m", ops: [add] }))).toBe("no error");
});

test("undo and redo; hand-broken files are reported and recoverable", () => {
  const w = ws();
  const { path } = createModel(w, { name: "m" });
  const empty = readFileSync(path, "utf8");
  editModel(w, { model: "m", ops: [{ add: { part: { name: "x", box: { size: [1, 1, 1] } } } }] });
  const one = readFileSync(path, "utf8");
  expect(undoModel(w, { model: "m" })).toMatchObject({ undo: 0, redo: 1 });
  expect(readFileSync(path, "utf8")).toBe(empty);
  redoModel(w, { model: "m" });
  expect(readFileSync(path, "utf8")).toBe(one);
  writeFileSync(path, "modelgen: 1\nparts: [\n");
  expect(code(() => inspectModel(w, { model: "m" }))).toBe("parse");
  expect(code(() => editModel(w, { model: "m", ops: [{ remove: { name: "x" } }] }))).toBe("parse");
  undoModel(w, { model: "m" });
  expect(readFileSync(path, "utf8")).toBe(one);
});

test("model names that could escape the models directory are rejected", () => {
  const w = ws();
  expect(code(() => inspectModel(w, { model: "../x" }))).toBe("invalid_name");
  expect(code(() => editModel(w, { model: "../x", ops: [{ remove: { name: "x" } }] }))).toBe("invalid_name");
  expect(code(() => undoModel(w, { model: "../x" }))).toBe("invalid_name");
});

test("malformed parts mid-batch fail as invalid_op, not a crash, and change nothing", () => {
  const w = ws();
  const { path } = createModel(w, { name: "m" });
  const before = readFileSync(path, "utf8");
  expect(code(() => editModel(w, { model: "m", ops: [{ add: { part: { name: "g", group: {} } } }, { add: { parent: "g", part: { name: "x", box: { size: [1, 1, 1] } } } }] }))).toBe("invalid_op");
  expect(code(() => editModel(w, { model: "m", ops: [{ add: { part: { name: "g2", group: { parts: [null] } } } }, { remove: { name: "zz" } }] }))).toBe("not_found");
  // with no later op tripping over it, the malformed part is caught by final validation
  expect(code(() => editModel(w, { model: "m", ops: [{ add: { part: { name: "g3", group: { parts: [null] } } } }] }))).toBe("schema");
  expect(readFileSync(path, "utf8")).toBe(before);
  expect(historyDepth(w, "m").undo).toBe(0);
});

test("inspect reports the requested model name, not the file's internal name", () => {
  const w = ws();
  const { path } = createModel(w, { name: "foo" });
  writeFileSync(path, readFileSync(path, "utf8").replace("name: foo", "name: bar"));
  expect(readFileSync(path, "utf8")).toContain("name: bar");
  expect(inspectModel(w, { model: "foo" }).model).toBe("foo");
});

test("duplicating an existing script part needs --allow-scripts", () => {
  const w = ws();
  const { path } = createModel(w, { name: "m" });
  writeFileSync(path, "modelgen: 1\nname: m\nparts:\n  - name: s\n    script:\n      module: x.js\n");
  expect(code(() => editModel(w, { model: "m", ops: [{ duplicate: { name: "s", as: "s2" } }] }))).toBe("scripts_disabled");
});
