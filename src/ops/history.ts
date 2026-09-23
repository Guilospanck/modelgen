import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OpError } from "../document";
import type { Workspace } from "./workspace";

export const HISTORY_LIMIT = 50;

const dirs = (ws: Workspace, model: string) => {
  const base = join(ws.stateDir, "history", model);
  return { undo: join(base, "undo"), redo: join(base, "redo"), last: join(base, "last.snap") };
};

const entries = (dir: string) => existsSync(dir) ? readdirSync(dir).filter(f => f.endsWith(".snap")).sort() : [];

function push(dir: string, text: string) {
  mkdirSync(dir, { recursive: true });
  const list = entries(dir);
  const next = list.length ? parseInt(list[list.length - 1], 10) + 1 : 1;
  writeFileSync(join(dir, `${String(next).padStart(9, "0")}.snap`), text);
  for (const old of entries(dir).slice(0, -HISTORY_LIMIT)) rmSync(join(dir, old));
}

function pop(dir: string): string | undefined {
  const list = entries(dir);
  if (!list.length) return undefined;
  const f = join(dir, list[list.length - 1]);
  const text = readFileSync(f, "utf8");
  rmSync(f);
  return text;
}

function setLast(ws: Workspace, model: string, text: string) {
  const d = dirs(ws, model);
  mkdirSync(join(d.last, ".."), { recursive: true });
  writeFileSync(d.last, text);
}

// A fresh model (or a copy): no history, current text is the baseline.
export function resetHistory(ws: Workspace, model: string, text: string) {
  rmSync(join(ws.stateDir, "history", model), { recursive: true, force: true });
  setLast(ws, model, text);
}

// If the file changed since our last write, record the old text as an undo step.
export function syncHandEdits(ws: Workspace, model: string, currentText: string) {
  const d = dirs(ws, model);
  if (!existsSync(d.last)) { setLast(ws, model, currentText); return; }
  const last = readFileSync(d.last, "utf8");
  if (last === currentText) return;
  push(d.undo, last);
  rmSync(d.redo, { recursive: true, force: true });
  setLast(ws, model, currentText);
}

export function recordEdit(ws: Workspace, model: string, before: string, after: string) {
  const d = dirs(ws, model);
  push(d.undo, before);
  rmSync(d.redo, { recursive: true, force: true });
  setLast(ws, model, after);
}

export function undoStep(ws: Workspace, model: string, currentText: string): string {
  const d = dirs(ws, model);
  const prev = pop(d.undo);
  if (prev === undefined) throw new OpError(`nothing to undo for "${model}"`, [{ severity: "error", code: "nothing_to_undo", message: `nothing to undo for "${model}"` }]);
  push(d.redo, currentText);
  setLast(ws, model, prev);
  return prev;
}

export function redoStep(ws: Workspace, model: string, currentText: string): string {
  const d = dirs(ws, model);
  const next = pop(d.redo);
  if (next === undefined) throw new OpError(`nothing to redo for "${model}"`, [{ severity: "error", code: "nothing_to_redo", message: `nothing to redo for "${model}"` }]);
  push(d.undo, currentText);
  setLast(ws, model, next);
  return next;
}

export function historyDepth(ws: Workspace, model: string) {
  const d = dirs(ws, model);
  return { undo: entries(d.undo).length, redo: entries(d.redo).length };
}
