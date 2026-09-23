import { test, expect } from "bun:test";
import { applyPoint, quatFromEuler, transformMesh, trsOf, IDENTITY } from "../src/scene/transform";
import { box } from "../src/engine/shapes";
import type { Vec3 } from "../src/engine/types";

const rotateByQuat = (p: number[], q: number[]) => {
  const [x, y, z, w] = q;
  const u = [x, y, z];
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const t = cross(u, p).map(v => 2 * v);
  const c = cross(u, t);
  return [p[0] + w * t[0] + c[0], p[1] + w * t[1] + c[1], p[2] + w * t[2] + c[2]];
};

test("quaternion matches the Euler rotation used for meshes", () => {
  for (const r of [[0.3, -1.2, 2.1], [Math.PI / 2, 0, 0], [0, 0, -0.7]] as Vec3[]) {
    const p = [0.4, -0.9, 1.3];
    const a = applyPoint(p, { t: [0, 0, 0], r, s: [1, 1, 1] });
    const b = rotateByQuat(p, quatFromEuler(r));
    a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 10));
  }
});

test("rotation about +y by 90° takes +x to -z", () => {
  const p = applyPoint([1, 0, 0], { t: [0, 0, 0], r: [0, Math.PI / 2, 0], s: [1, 1, 1] });
  expect(p[0]).toBeCloseTo(0); expect(p[2]).toBeCloseTo(-1);
});

test("identity returns the same mesh; mirroring flips winding", () => {
  const m = box(1, 1, 1);
  expect(transformMesh(m, IDENTITY)).toBe(m);
  const mirrored = transformMesh(m, trsOf({ scale: [-1, 1, 1] }));
  expect(mirrored.idx.slice(0, 3)).toEqual([m.idx[0], m.idx[2], m.idx[1]]);
});
