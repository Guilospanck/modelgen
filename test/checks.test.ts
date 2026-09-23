import { test, expect } from "bun:test";
import { checkScene } from "../src/checks";
import { part, place, uvSphere } from "../src/engine/lib";
import type { FlatPart } from "../src/scene/compile";

const ball = (owner: string, t: number[], opts: object = {}): FlatPart => ({ owner, part: part(place(uvSphere(), { s: 0.2, t }), "#aa5533", opts) });

test("a connected model has no issues", () => {
  expect(checkScene([ball("a", [0, 0, 0]), ball("b", [0.3, 0, 0])])).toEqual([]);
});

test("a floating part is named, with the nearest part in the hint", () => {
  const issues = checkScene([ball("body", [0, 0, 0]), ball("head", [0.3, 0, 0]), ball("handle", [2, 0, 0])]);
  expect(issues).toHaveLength(1);
  expect(issues[0]).toMatchObject({ code: "floating", part: "handle", severity: "error" });
  expect(issues[0].message).toBe('"handle" is not touching the rest of the model');
  expect(issues[0].hint).toContain('nearest is "head"');
});

test("surface parts are exempt from the floating check", () => {
  expect(checkScene([ball("body", [0, 0, 0]), ball("tuft", [3, 0, 0], { surf: true })])).toEqual([]);
});

test("empty and degenerate models", () => {
  expect(checkScene([])[0].code).toBe("empty");
  const flat: FlatPart = { owner: "bad", part: { mesh: { pos: [[0, 0, 0]], idx: [], uv: [[0, 0]] }, color: "#ffffff" } };
  const issues = checkScene([ball("ok", [0, 0, 0]), flat]);
  expect(issues.map(i => [i.code, i.part])).toEqual([["degenerate", "bad"]]);
});
