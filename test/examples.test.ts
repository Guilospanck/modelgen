import { test, expect } from "bun:test";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error no types shipped
import { validateBytes } from "gltf-validator";
import { openWorkspace, buildProject, capture, listModels } from "../src";
import { readUsda } from "../src/export/usdz";
import { glbJson } from "../src/export/glb";
import { stableGlbJson } from "./glb-json";

const copy = () => { const d = mkdtempSync(join(tmpdir(), "modelgen-ex-")); cpSync(join(__dirname, "../examples"), d, { recursive: true }); return d; };

test("every example builds, validates and captures cleanly", async () => {
  const root = copy();
  const ws = openWorkspace(root);
  const names = listModels(ws).models.map(m => m.name);
  expect(names).toEqual(["crate", "keycap", "lantern", "mug", "pebble"]);
  const r = buildProject(ws);
  expect(r.failed).toEqual([]);
  for (const name of names) {
    const report = await validateBytes(new Uint8Array(readFileSync(join(root, "out", `${name}.glb`))));
    expect(report.issues.numErrors).toBe(0);
    expect(capture(ws, { model: name, size: 96 }).issues).toEqual([]);
    // golden outputs: the first run writes test/__snapshots__/; later runs must match
    expect(readUsda(readFileSync(join(root, "out", `${name}.usdz`)))).toMatchSnapshot();
    expect(stableGlbJson(glbJson(readFileSync(join(root, "out", `${name}.glb`))))).toMatchSnapshot();
  }
}, 60_000);
