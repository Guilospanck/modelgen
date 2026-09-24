import { test, expect } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildModel } from "../src/browser";
import { loadModelFile } from "../src/document";
import { compileModel } from "../src/scene/compile";
import { exportModelFiles } from "../src/export/model";
import { buildWeb } from "../scripts/build-web";

const examples = join(__dirname, "../examples");
const text = (name: string) => readFileSync(join(examples, `${name}.model.yaml`), "utf8");

test("buildModel matches the Node export byte for byte", () => {
  for (const name of ["crate", "lantern", "mug"]) {
    const file = join(examples, `${name}.model.yaml`);
    const { doc } = loadModelFile(file);
    const node = exportModelFiles(doc, compileModel(doc, { baseDir: examples }), ["glb", "usdz"]);
    const web = buildModel(text(name));
    expect(web.name).toBe(name);
    expect(web.issues).toEqual([]);
    expect(web.files.map(f => f.format)).toEqual(["glb", "usdz"]);
    web.files.forEach((f, i) => expect(Buffer.compare(f.data, node.files[i].data)).toBe(0));
  }
});

test("script parts come back as an issue instead of running", () => {
  const r = buildModel(text("pebble"));
  expect(r.files).toEqual([]);
  expect(r.issues).toEqual([expect.objectContaining({ severity: "error", code: "script", part: "stone" })]);
});

test("bad YAML, bad schema and floating parts are issues, not throws", () => {
  expect(buildModel("parts: [").issues[0].code).toBe("parse");
  expect(buildModel("modelgen: 1\nname: x\nparts: [{name: a, box: {size: 1}}]").issues.some(i => i.code === "schema")).toBe(true);
  const floating = buildModel("modelgen: 1\nname: x\nparts:\n  - {name: a, box: {size: [1, 1, 1]}}\n  - {name: b, box: {size: [1, 1, 1]}, position: [5, 0, 0]}");
  expect(floating.files).toEqual([]);
  expect(floating.issues.some(i => i.severity === "error")).toBe(true);
});

test("the web bundle runs without Node's Buffer and zlib", async () => {
  const out = mkdtempSync(join(tmpdir(), "modelgen-web-"));
  await buildWeb(out);
  expect(readdirSync(out).sort()).toEqual(["app.js", "examples.json", "index.html", "modelgen.js", "style.css", "viewer.js"]);
  expect(JSON.parse(readFileSync(join(out, "examples.json"), "utf8")).map((e: { name: string }) => e.name)).toEqual(["crate", "lantern", "mug"]);

  // Plain Node with the browser-missing globals removed stands in for a browser.
  writeFileSync(join(out, "package.json"), '{"type": "module"}');
  const probe = join(out, "probe.js");
  writeFileSync(probe, `
    delete globalThis.Buffer;
    const { buildModel } = await import("./modelgen.js");
    const r = buildModel(${JSON.stringify(text("lantern"))});
    const glb = r.files.find(f => f.format === "glb").data;
    console.log(JSON.stringify({ issues: r.issues, magic: String.fromCharCode(...glb.subarray(0, 4)) }));
  `);
  const run = Bun.spawnSync(["node", probe], { stderr: "pipe" });
  expect(run.stderr.toString()).toBe("");
  expect(JSON.parse(run.stdout.toString())).toEqual({ issues: [], magic: "glTF" });
}, 60_000);
