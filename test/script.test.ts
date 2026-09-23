import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScript } from "../src/scene/script";
import { OpError, type Part } from "../src/document";

const dir = () => mkdtempSync(join(tmpdir(), "modelgen-script-"));
const scriptPart = (module: string, params?: Record<string, unknown>): Part => ({ name: "s", script: { module, ...(params ? { params } : {}) } });
const code = (color: string) => `module.exports = (params, kit) => ({ parts: [kit.lib.part(kit.lib.uvSphere(), params.color ?? "${color}")], textures: {} });`;
const expectScriptError = (fn: () => unknown, text: string) => {
  try { fn(); throw new Error("should have thrown"); } catch (e) {
    expect(e).toBeInstanceOf(OpError);
    expect((e as OpError).issues[0].code).toBe("script");
    expect((e as OpError).issues[0].message).toContain(text);
  }
};

test("runs a builder with params and the kit", () => {
  const d = dir();
  writeFileSync(join(d, "a.js"), code("#ff0000"));
  expect(runScript(scriptPart("a.js"), d).parts[0].color).toBe("#ff0000");
  expect(runScript(scriptPart("a.js", { color: "#00ff00" }), d).parts[0].color).toBe("#00ff00");
});

test("picks up edits to the script and its helpers between calls", () => {
  const d = dir();
  writeFileSync(join(d, "helper.js"), `module.exports = "#111111";`);
  writeFileSync(join(d, "b.js"), `const c = require("./helper"); module.exports = (p, kit) => ({ parts: [kit.lib.part(kit.lib.uvSphere(), c)] });`);
  expect(runScript(scriptPart("b.js"), d).parts[0].color).toBe("#111111");
  writeFileSync(join(d, "helper.js"), `module.exports = "#222222";`);
  expect(runScript(scriptPart("b.js"), d).parts[0].color).toBe("#222222");
});

test("accepts default and build exports", () => {
  const d = dir();
  writeFileSync(join(d, "c.js"), `exports.default = (p, kit) => ({ parts: [kit.lib.part(kit.lib.uvSphere(), "#123456")] });`);
  writeFileSync(join(d, "e.js"), `exports.build = (p, kit) => ({ parts: [kit.lib.part(kit.lib.uvSphere(), "#654321")] });`);
  expect(runScript(scriptPart("c.js"), d).parts[0].color).toBe("#123456");
  expect(runScript(scriptPart("e.js"), d).parts[0].color).toBe("#654321");
});

test("reports missing files, bad exports, throws and bad output", () => {
  const d = dir();
  expectScriptError(() => runScript(scriptPart("nope.js"), d), "script not found");
  writeFileSync(join(d, "f.js"), `module.exports = 42;`);
  expectScriptError(() => runScript(scriptPart("f.js"), d), "must export a build function");
  writeFileSync(join(d, "g.js"), `module.exports = () => { throw new Error("boom"); };`);
  expectScriptError(() => runScript(scriptPart("g.js"), d), "boom");
  writeFileSync(join(d, "h.js"), `module.exports = (p, kit) => ({ parts: [kit.lib.part(kit.lib.uvSphere(), "red")] });`);
  expectScriptError(() => runScript(scriptPart("h.js"), d), "bad color");
  writeFileSync(join(d, "i.js"), `module.exports = (p, kit) => ({ parts: [kit.lib.part(kit.lib.uvSphere(), "#ffffff", { tex: "skin" })] });`);
  expectScriptError(() => runScript(scriptPart("i.js"), d), 'missing texture "skin"');
});
