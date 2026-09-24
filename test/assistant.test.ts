import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promptFor, followUpFor, parseOpsReply, opsSchema } from "../src/assistant";
import { editModel, parseModel } from "../src/browser";

const lantern = readFileSync(join(__dirname, "../examples/lantern.model.yaml"), "utf8");
const floating = [{ severity: "error" as const, code: "floating", part: "leg", message: '"leg" is not touching the rest of the model', hint: "move it" }];

test("the full prompt carries the rules, the model, current problems and the request", () => {
  const p = promptFor({ request: "add a red ball on top", text: lantern, issues: floating });
  expect(p.system).toContain('{"ops"');
  expect(p.system).toContain("lathe");
  expect(p.system).toContain("text:");
  expect(p.user).toContain("name: lantern");
  expect(p.user).toContain('"leg" is not touching');
  expect(p.user.trim().endsWith("add a red ball on top")).toBe(true);
});

test("the compact prompt fits a 4k-token local model with room to answer", () => {
  const p = promptFor({ request: "make the handle thicker", text: lantern, compact: true });
  // ~4 characters per token: leave well over 1500 tokens for the reply.
  expect((p.system.length + p.user.length) / 4).toBeLessThan(2000);
  expect(p.system).toContain('"update"');
});

test("a follow-up reports what went wrong and restates the request", () => {
  const f = followUpFor({ request: "add legs", text: lantern, issues: floating });
  expect(f).toContain('"leg" is not touching');
  expect(f).toContain("add legs");
  expect(followUpFor({ request: "add legs", text: lantern, rejected: 'no part named "x"' })).toContain('no part named "x"');
});

test("replies are read whether fenced, chatty, an object or a bare list", () => {
  const ops = [{ remove: { name: "cap" } }];
  expect(parseOpsReply(JSON.stringify({ ops }))).toEqual({ ops });
  expect(parseOpsReply("Sure! Here you go:\n```json\n" + JSON.stringify({ ops }, null, 2) + "\n```\nEnjoy.")).toEqual({ ops });
  expect(parseOpsReply(JSON.stringify(ops))).toEqual({ ops });
  expect(parseOpsReply("I can't do that.").error).toBeDefined();
  expect(parseOpsReply('{"ops": [').error).toBeDefined();
  expect(parseOpsReply('{"ops": []}').error).toBeDefined();
});

test("parsed ops apply through the normal edit path", () => {
  const { ops } = parseOpsReply('```json\n{"ops":[{"set_material":{"name":"red","material":{"color":"#cc2222"}}},{"add":{"part":{"name":"ball","sphere":{"radius":0.05},"position":[0,0.95,0],"material":"red"}}}]}\n```');
  const r = editModel(lantern, ops!);
  expect(r.issues).toEqual([]);
  expect(r.text).toContain("name: ball");
});

test("the output schema names the model's real parts and materials", () => {
  const doc = parseModel(lantern).doc!;
  const s = opsSchema(doc) as any;
  const json = JSON.stringify(s);
  expect(json).toContain('"enum":["base","body","cap","handle"]');
  expect(s.properties.ops.type).toBe("array");
  expect(s.$defs).toBeDefined();
  // An empty model has nothing to update or remove yet.
  const empty = JSON.stringify(opsSchema({ modelgen: 1, name: "x", parts: [] }));
  expect(empty).not.toContain('"update"');
  expect(empty).toContain('"add"');
});
