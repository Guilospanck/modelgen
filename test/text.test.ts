import { test, expect } from "bun:test";
import { text, missingChars } from "../src/engine/text";
import { parseModelText, validateDocument } from "../src/document";
import type { Mesh } from "../src/engine/types";

const bounds = (m: Mesh) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of m.pos) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
  return { mn, mx };
};
// Signed volume: positive only when every face points outward.
const volume = (m: Mesh) => {
  let v = 0;
  for (let i = 0; i < m.idx.length; i += 3) {
    const [a, b, c] = [m.pos[m.idx[i]], m.pos[m.idx[i + 1]], m.pos[m.idx[i + 2]]];
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return v;
};

test("capital letters are `size` tall, centred on y, `depth` deep, centred on z", () => {
  const { mn, mx } = bounds(text({ string: "H", size: 0.1, depth: 0.02 }));
  expect(mx[1] - mn[1]).toBeCloseTo(0.1, 3);
  expect(mn[1]).toBeCloseTo(-0.05, 3);
  expect(mn[2]).toBeCloseTo(-0.01, 6);
  expect(mx[2]).toBeCloseTo(0.01, 6);
});

test("align puts the text right of, around, or left of the origin", () => {
  const w = (align: "left" | "center" | "right") => bounds(text({ string: "Esc", size: 0.1, depth: 0.01, align }));
  expect(w("left").mn[0]).toBeGreaterThanOrEqual(0);
  expect(w("right").mx[0]).toBeLessThanOrEqual(1e-9);
  const c = w("center");
  expect(Math.abs(c.mn[0] + c.mx[0])).toBeLessThan(0.01);
});

test("faces point outward and holes stay open", () => {
  const I = text({ string: "I", size: 0.1, depth: 0.01 });
  const O = text({ string: "O", size: 0.1, depth: 0.01 });
  expect(volume(I)).toBeGreaterThan(0);
  expect(volume(O)).toBeGreaterThan(0);
  // "I" is a solid bar; an "O" is a ring: far less material than its bounding box.
  const { mn, mx } = bounds(O);
  expect(volume(O)).toBeLessThan((mx[0] - mn[0]) * (mx[1] - mn[1]) * 0.01 * 0.6);
});

test("kerning and spacing change the width; spaces and new lines take room", () => {
  const width = (s: string, spacing = 0) => { const b = bounds(text({ string: s, size: 0.1, depth: 0.01, spacing })); return b.mx[0] - b.mn[0]; };
  expect(width("AV")).toBeLessThan(width("A") + width("V") + 0.02);
  expect(width("AV", 0.2)).toBeGreaterThan(width("AV") + 0.015);
  expect(width("A A")).toBeGreaterThan(width("AA"));
  const two = bounds(text({ string: "A\nA", size: 0.1, depth: 0.01 }));
  expect(two.mx[1] - two.mn[1]).toBeGreaterThan(0.2);
});

test("characters the font lacks are reported, by the checker and by validation", () => {
  expect(missingChars("Esc ⌘")).toEqual(["⌘"]);
  expect(missingChars("Ünïcödé €")).toEqual([]);
  const { issues } = validateDocument(parseModelText("modelgen: 1\nname: k\nparts:\n  - name: t\n    text: {string: \"⌘K\", size: 0.01, depth: 0.001}\n", "m.yaml"));
  expect(issues[0].message).toContain("⌘");
});
