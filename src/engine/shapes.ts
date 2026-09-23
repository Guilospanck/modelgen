import { tube, slab, uvSphere, place } from "./lib";
import type { Mesh, Vec2 } from "./types";

// Axis-aligned box: 4 vertices per face so each face keeps a flat normal.
export function box(sx: number, sy: number, sz: number): Mesh {
  const h = [sx / 2, sy / 2, sz / 2];
  // [normal, u axis, v axis] with u × v = normal (outward, counter-clockwise)
  const faces: number[][][] = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const pos: number[][] = [], idx: number[] = [], uv: number[][] = [];
  for (const [n, u, v] of faces) {
    const base = pos.length;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push([0, 1, 2].map(k => (n[k] + u[k] * a + v[k] * b) * h[k]));
      uv.push([(a + 1) / 2, (1 - b) / 2]);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { pos, idx, uv };
}

export function sphere(r: number, seg = 24): Mesh {
  return place(uvSphere(seg, Math.max(3, Math.round(seg * 0.75))), { s: r });
}

export function cylinder(rTop: number, rBottom: number, h: number, seg = 24): Mesh {
  return tube([[0, -h / 2, 0], [0, h / 2, 0]], [rBottom, rTop], seg);
}

export function cone(r: number, h: number, seg = 24): Mesh {
  return cylinder(1e-4, r, h, seg);
}

// Surface of revolution about y; profile points are [radius, y].
export function lathe(profile: Vec2[], seg = 24): Mesh {
  const n = profile.length, pos: number[][] = [], idx: number[] = [], uv: number[][] = [];
  for (let i = 0; i < n; i++)
    for (let u = 0; u <= seg; u++) {
      const th = (u / seg) * 2 * Math.PI, [r, y] = profile[i];
      pos.push([r * Math.cos(th), y, r * Math.sin(th)]);
      uv.push([u / seg, i / (n - 1)]);
    }
  const at = (i: number, u: number) => i * (seg + 1) + u;
  for (let i = 0; i < n - 1; i++)
    for (let u = 0; u < seg; u++) {
      const a = at(i, u), b = at(i, u + 1), c = at(i + 1, u + 1), d = at(i + 1, u);
      if (profile[i + 1][0] > 1e-9) idx.push(a, d, c);   // skip when the upper ring collapses to the axis
      if (profile[i][0] > 1e-9) idx.push(a, c, b);       // skip when the lower ring collapses to the axis
    }
  return { pos, idx, uv };
}

export function capsule(r: number, length: number, seg = 24): Mesh {
  const q = Math.max(4, Math.round(seg / 4)), profile: Vec2[] = [];
  for (let k = 0; k <= q; k++) {
    const a = -Math.PI / 2 + (k / q) * (Math.PI / 2);
    profile.push([r * Math.cos(a), -length / 2 + r * Math.sin(a)]);
  }
  for (let k = 0; k <= q; k++) {
    const a = (k / q) * (Math.PI / 2);
    profile.push([r * Math.cos(a), length / 2 + r * Math.sin(a)]);
  }
  profile[0][0] = 0; profile[profile.length - 1][0] = 0;
  return lathe(profile, seg);
}

export function torus(R: number, r: number, seg = 32): Mesh {
  const minor = Math.max(8, Math.round(seg / 2)), pos: number[][] = [], idx: number[] = [], uv: number[][] = [];
  for (let i = 0; i <= seg; i++)
    for (let j = 0; j <= minor; j++) {
      const u = (i / seg) * 2 * Math.PI, v = (j / minor) * 2 * Math.PI;
      pos.push([(R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u)]);
      uv.push([i / seg, j / minor]);
    }
  const at = (i: number, j: number) => i * (minor + 1) + j;
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < minor; j++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      idx.push(a, d, c, a, c, b);
    }
  return { pos, idx, uv };
}

export function plane(sx: number, sz: number): Mesh {
  const hx = sx / 2, hz = sz / 2;
  return {
    pos: [[-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz]],
    idx: [0, 2, 1, 0, 3, 2],
    uv: [[0, 0], [1, 0], [1, 1], [0, 1]],
  };
}

// Profile in xy, extruded along z and centred. Caps are fanned from the
// profile's centroid, so the profile must be convex or star-shaped.
export function extrude(profile: Vec2[], depth: number): Mesh {
  return slab(profile, depth);
}
