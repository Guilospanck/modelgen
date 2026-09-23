import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspace, modelFile, requireModelFile, listModelNames, selectModels } from "../src/ops/workspace";
import { OpError } from "../src/document";

const tmp = () => mkdtempSync(join(tmpdir(), "modelgen-ws-"));

test("defaults without a config", () => {
  const root = tmp();
  const ws = openWorkspace(root);
  expect(ws.modelsDir).toBe(join(root, "models"));
  expect(ws.previewsDir).toBe(join(root, "previews"));
  expect(ws.stateDir).toBe(join(root, ".modelgen"));
  expect(ws.config).toBeUndefined();
});

test("config sets dirs and outputs; bad config is a config issue", () => {
  const root = tmp();
  writeFileSync(join(root, "modelgen.yaml"), "models: assets/src\npreviews: out/previews\noutputs:\n  - dir: build\n    formats: [glb]\n");
  const ws = openWorkspace(root);
  expect(ws.modelsDir).toBe(join(root, "assets/src"));
  expect(ws.config?.outputs?.[0].formats).toEqual(["glb"]);
  writeFileSync(join(root, "modelgen.yaml"), "outputs:\n  - dir: build\n    formats: [fbx]\n");
  try { openWorkspace(root); throw new Error("should throw"); } catch (e) {
    expect((e as OpError).issues[0].code).toBe("config");
    expect((e as OpError).issues[0].message).toContain("outputs[0].formats[0]");
  }
});

test("model files: yaml preferred, json accepted, missing is not_found", () => {
  const root = tmp(), ws = openWorkspace(root);
  mkdirSync(ws.modelsDir, { recursive: true });
  writeFileSync(join(ws.modelsDir, "a.model.yaml"), "");
  writeFileSync(join(ws.modelsDir, "b.model.json"), "");
  writeFileSync(join(ws.modelsDir, "notes.txt"), "");
  expect(modelFile(ws, "b")).toBe(join(ws.modelsDir, "b.model.json"));
  expect(listModelNames(ws)).toEqual(["a", "b"]);
  try { requireModelFile(ws, "zzz"); throw new Error("should throw"); } catch (e) {
    expect((e as OpError).issues[0].code).toBe("not_found");
    expect((e as OpError).issues[0].hint).toContain("a, b");
  }
});

test("selectModels with wildcards and exclusions", () => {
  const names = ["cosmetic_hat", "cosmetic_scarf", "dragon", "horse"];
  expect(selectModels(names)).toEqual(names);
  expect(selectModels(names, ["cosmetic_*"])).toEqual(["cosmetic_hat", "cosmetic_scarf"]);
  expect(selectModels(names, ["*", "!cosmetic_*"])).toEqual(["dragon", "horse"]);
});
