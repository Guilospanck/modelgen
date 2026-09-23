"use strict";
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const { loadBuilders, buildModel, validateUsdz, validateGlb } = require("../build");
const { anchorsFor, toModelSpace } = require("../anchors");
const { emit, lint, run } = require("../life/dsl");
const lib = require("../lib");

const builders = loadBuilders(path.join(__dirname, "../examples"));

test("example builds to valid usdz and glb", () => {
  const model = builders.lantern();
  const usdz = buildModel(model, { format: "usdz" });
  assert.deepStrictEqual(validateUsdz(usdz.data, usdz.stats.tex * 2 + 1), []);
  const glb = buildModel(model, { format: "glb" });
  assert.deepStrictEqual(validateGlb(glb.data), []);
  const doc = JSON.parse(glb.data.toString("utf8", 20, 20 + glb.data.readUInt32LE(12)));
  assert.strictEqual(doc.meshes[0].primitives.length, usdz.stats.mats);
  assert.strictEqual(doc.images.length, 2); // diffuse + normal of the one skin
});

test("floating parts are rejected", () => {
  const blob = s => lib.place(lib.uvSphere(), { s: 0.2, t: s });
  const parts = [lib.part(blob([0, 0, 0]), "#aa5533"), lib.part(blob([5, 0, 0]), "#aa5533")];
  assert.throws(() => buildModel({ parts }), /DISCONNECTED/);
  assert.doesNotThrow(() => buildModel({ parts }, { connectivity: false }));
});

test("keepOrigin preserves authored frame", () => {
  const parts = [lib.part(lib.tube([[0, 0, 0], [0, 0.4, 0]], [0.5, 0.5], 12), "#202020")];
  for (const format of ["usdz", "glb"]) assert.doesNotThrow(() => buildModel({ parts }, { format, keepOrigin: true }));
});

test("anchors land in model space", () => {
  const { parts } = builders.lantern();
  const raw = anchorsFor(parts, ["head", "tail", "bogus"]);
  assert.ok(raw.head && raw.tail && !raw.bogus);
  const shipped = toModelSpace(JSON.parse(JSON.stringify(raw)), parts);
  for (const k of [0, 1, 2]) assert.ok(Math.abs(shipped.head.pos[k]) <= 1.2);
  assert.deepStrictEqual(anchorsFor(parts, ["head"], { head: { pos: [1, 2, 3], scale: 4 } }).head, { pos: [1, 2, 3], scale: 4 });
});

test("life DSL runs in JS and emits lint-clean Metal", () => {
  const program = [{ mask: "top", halfspace: { o: [0, 0, 0], d: [0, 1, 0], ramp: [0, 0.5] } }, { rot: "y", angle: "0.3 * sin(t)", weight: "top" }];
  const [p] = run(program, [0, 1, 1], [0, 1, 0], 1.0);
  assert.notDeepStrictEqual(p, [0, 1, 1]);
  assert.deepStrictEqual(lint(emit(program)), []);
});

test("CLI runs every command on the examples", () => {
  const { execFileSync } = require("child_process");
  const fs = require("fs");
  const os = require("os");
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "modelgen-"));
  const cli = (...a) => execFileSync(process.execPath, [path.join(__dirname, "../cli.js"), ...a], { cwd: path.join(__dirname, ".."), stdio: "pipe" });
  cli("build", "examples", "--out", out, "--format", "usdz,glb");
  cli("render", "examples", "--out", out, "--views", "0:0,90:0", "--prefix", "p_");
  cli("anchors", "examples", "--config", "examples/anchors.config.json", "--out", path.join(out, "anchors.json"));
  cli("life", "examples", "--config", "examples/life.config.json", "--anchors", path.join(out, "anchors.json"), "--out", path.join(out, "life.json"));
  for (const f of ["lantern.usdz", "lantern.glb", "p_lantern.png", "anchors.json", "life.json"]) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(out, "anchors.json")))).sort(), ["lantern"]);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, "life.json"))).lantern.plan, "biped");
  assert.throws(() => cli("build", "examples", "--out", out, "--bogus"));
});
