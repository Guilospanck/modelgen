import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assemble, uvSphere, place, part } from "../src/engine/lib";
import { preview } from "../src/engine/render";
import { paintSkins } from "../src/export/skins";
import { writeUsdz, validateUsdz, readUsda } from "../src/export/usdz";
import { glb, validateGlb } from "../src/export/glb";
import { connectivityIssues } from "../src/checks/connectivity";
import { decodePng } from "../src/util/png";
import lantern from "./fixtures/lantern-builder";

const fixture = (f: string) => readFileSync(`${__dirname}/fixtures/${f}`, "utf8");

test("usda text is unchanged by the port", () => {
  const m = lantern();
  const u = writeUsdz(assemble(m.parts), paintSkins(m.textures));
  expect(validateUsdz(u, 3)).toEqual([]);
  expect(readUsda(u)).toBe(fixture("lantern.usda"));
});

test("glb json is unchanged by the port", () => {
  const m = lantern();
  const g = glb(assemble(m.parts), paintSkins(m.textures));
  expect(validateGlb(g)).toEqual([]);
  expect(g.toString("utf8", 20, 20 + g.readUInt32LE(12))).toBe(fixture("lantern.glb.json"));
});

test("preview pixels are unchanged by the port", () => {
  const { pixels } = decodePng(preview(lantern()));
  expect(createHash("sha256").update(pixels).digest("hex") + "\n").toBe(fixture("lantern.preview.sha256"));
});

test("connectivity: lantern connected, far spheres not", () => {
  expect(connectivityIssues(lantern().parts)).toBeNull();
  const blob = (t: number[]) => part(place(uvSphere(), { s: 0.2, t }), "#aa5533");
  expect(connectivityIssues([blob([0, 0, 0]), blob([5, 0, 0])])).toContain("2 components");
});
