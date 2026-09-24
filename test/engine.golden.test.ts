import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { assemble, uvSphere, place, part } from "../src/engine/lib";
import { preview } from "../src/engine/render";
import { paintSkins } from "../src/export/skins";
import { writeUsdz, validateUsdz, readUsda } from "../src/export/usdz";
import { glb, glbJson, validateGlb } from "../src/export/glb";
import { stableGlbJson } from "./glb-json";
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
  expect(stableGlbJson(glbJson(g))).toEqual(stableGlbJson(JSON.parse(fixture("lantern.glb.json"))));
});

test("preview pixels are unchanged by the port", () => {
  // The views the golden was taken with (the defaults then); the renderer's output is what's pinned.
  const { pixels } = decodePng(preview(lantern(), { views: [[205, 15], [270, 5], [155, 30]] }));
  expect(createHash("sha256").update(pixels).digest("hex") + "\n").toBe(fixture("lantern.preview.sha256"));
});

test("connectivity: lantern connected, far spheres not", () => {
  expect(connectivityIssues(lantern().parts)).toBeNull();
  const blob = (t: number[]) => part(place(uvSphere(), { s: 0.2, t }), "#aa5533");
  expect(connectivityIssues([blob([0, 0, 0]), blob([5, 0, 0])])).toContain("2 components");
});
