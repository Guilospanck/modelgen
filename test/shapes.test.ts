import { test, expect } from "bun:test";
import { box, sphere, cylinder, cone, capsule, torus, plane, lathe, extrude } from "../src/engine/shapes";
import type { Mesh } from "../src/engine/types";

const bounds = (m: Mesh) => {
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of m.pos) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
  return { mn, mx };
};
const close = (a: number[], b: number[], eps = 1e-6) => a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(eps));
const wellFormed = (m: Mesh) => {
  expect(m.idx.length % 3).toBe(0);
  expect(m.idx.length).toBeGreaterThan(0);
  expect(m.uv.length).toBe(m.pos.length);
  for (const i of m.idx) expect(i >= 0 && i < m.pos.length).toBe(true);
  for (const v of m.pos) for (const c of v) expect(Number.isFinite(c)).toBe(true);
};
const area2 = (m: Mesh, t: number) => {
  const [a, b, c] = [m.pos[m.idx[t]], m.pos[m.idx[t + 1]], m.pos[m.idx[t + 2]]];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
};

test("box", () => {
  const m = box(2, 4, 6);
  wellFormed(m);
  expect(m.pos.length).toBe(24);
  expect(m.idx.length).toBe(36);
  const { mn, mx } = bounds(m);
  close(mn, [-1, -2, -3]); close(mx, [1, 2, 3]);
});

test("box faces wind outward", () => {
  const m = box(1, 1, 1);
  for (let t = 0; t < m.idx.length; t += 3) {
    const [a, b, c] = [m.pos[m.idx[t]], m.pos[m.idx[t + 1]], m.pos[m.idx[t + 2]]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const centre = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    expect(n[0] * centre[0] + n[1] * centre[1] + n[2] * centre[2]).toBeGreaterThan(0);
  }
});

test("sphere, cylinder, cone", () => {
  const s = sphere(0.5); wellFormed(s);
  close(bounds(s).mx, [0.5, 0.5, 0.5], 1e-3);
  const c = cylinder(0.2, 0.4, 2); wellFormed(c);
  expect(bounds(c).mn[1]).toBeCloseTo(-1); expect(bounds(c).mx[1]).toBeCloseTo(1);
  expect(bounds(c).mx[0]).toBeCloseTo(0.4, 3);
  const k = cone(0.3, 1); wellFormed(k);
  const top = k.pos.filter(p => p[1] > 0.49);
  for (const p of top) expect(Math.hypot(p[0], p[2])).toBeLessThan(1e-3);
});

test("capsule, torus, plane", () => {
  const c = capsule(0.25, 1); wellFormed(c);
  expect(bounds(c).mn[1]).toBeCloseTo(-0.75); expect(bounds(c).mx[1]).toBeCloseTo(0.75);
  const t = torus(1, 0.25); wellFormed(t);
  expect(bounds(t).mx[0]).toBeCloseTo(1.25); expect(bounds(t).mx[1]).toBeCloseTo(0.25);
  const p = plane(2, 4); wellFormed(p);
  close(bounds(p).mn, [-1, 0, -2]); close(bounds(p).mx, [1, 0, 2]);
});

test("lathe skips degenerate triangles at the axis", () => {
  const m = lathe([[0, 0], [1, 0.5], [0, 1]], 12); wellFormed(m);
  for (let t = 0; t < m.idx.length; t += 3) expect(area2(m, t)).toBeGreaterThan(1e-9);
  expect(bounds(m).mx[0]).toBeCloseTo(1);
});

test("extrude", () => {
  const m = extrude([[0, 0], [1, 0], [1, 1], [0, 1]], 0.5); wellFormed(m);
  expect(bounds(m).mn[2]).toBeCloseTo(-0.25); expect(bounds(m).mx[2]).toBeCloseTo(0.25);
});
