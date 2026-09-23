import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorkspace } from "../src/ops/workspace";
import { resetHistory, recordEdit, syncHandEdits, undoStep, redoStep, historyDepth, HISTORY_LIMIT } from "../src/ops/history";

const ws = () => openWorkspace(mkdtempSync(join(tmpdir(), "modelgen-hist-")));

test("undo and redo walk the edit stack", () => {
  const w = ws();
  resetHistory(w, "m", "S0");
  recordEdit(w, "m", "S0", "S1");
  recordEdit(w, "m", "S1", "S2");
  expect(undoStep(w, "m", "S2")).toBe("S1");
  expect(undoStep(w, "m", "S1")).toBe("S0");
  expect(() => undoStep(w, "m", "S0")).toThrow(/nothing to undo/);
  expect(redoStep(w, "m", "S0")).toBe("S1");
  expect(historyDepth(w, "m")).toEqual({ undo: 1, redo: 1 });
});

test("a new edit clears redo", () => {
  const w = ws();
  resetHistory(w, "m", "S0");
  recordEdit(w, "m", "S0", "S1");
  undoStep(w, "m", "S1");
  recordEdit(w, "m", "S0", "S2");
  expect(historyDepth(w, "m").redo).toBe(0);
});

test("hand edits between operations become their own undo step", () => {
  const w = ws();
  resetHistory(w, "m", "S0");
  recordEdit(w, "m", "S0", "S1");
  syncHandEdits(w, "m", "HAND");
  recordEdit(w, "m", "HAND", "S2");
  expect(undoStep(w, "m", "S2")).toBe("HAND");
  expect(undoStep(w, "m", "HAND")).toBe("S1");
  expect(undoStep(w, "m", "S1")).toBe("S0");
});

test("history keeps the last 50 steps", () => {
  const w = ws();
  resetHistory(w, "m", "0");
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) recordEdit(w, "m", String(i), String(i + 1));
  expect(historyDepth(w, "m").undo).toBe(HISTORY_LIMIT);
});
