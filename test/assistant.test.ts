import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promptFor, followUpFor, parseOpsReply } from "../src/assistant";
import { editModel } from "../src/browser";

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
