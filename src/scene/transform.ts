import type { Mesh, Vec3 } from "../engine/types";

// Same convention as the engine's place(): scale, then rotate (R = Rz·Ry·Rx), then translate.
export type TRS = { t: Vec3; r: Vec3; s: Vec3 };
export const IDENTITY: TRS = { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };

export function trsOf(p: { position?: Vec3; rotation?: Vec3; scale?: number | Vec3 }): TRS {
  const s: Vec3 = p.scale === undefined ? [1, 1, 1] : typeof p.scale === "number" ? [p.scale, p.scale, p.scale] : p.scale;
  return { t: p.position ?? [0, 0, 0], r: p.rotation ?? [0, 0, 0], s };
}

export const isIdentity = (x: TRS) => x.t.every(v => v === 0) && x.r.every(v => v === 0) && x.s.every(v => v === 1);

export function rotMat(r: Vec3): number[][] {
  const [rx, ry, rz] = r;
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

const mulMV = (R: number[][], v: number[]) => [
  R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
  R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
  R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
];

export function applyPoint(p: number[], x: TRS, R = rotMat(x.r)): number[] {
  const q = mulMV(R, [p[0] * x.s[0], p[1] * x.s[1], p[2] * x.s[2]]);
  return [q[0] + x.t[0], q[1] + x.t[1], q[2] + x.t[2]];
}

export function transformMesh(m: Mesh, x: TRS): Mesh {
  if (isIdentity(x)) return m;
  const R = rotMat(x.r);
  const mirrored = x.s[0] * x.s[1] * x.s[2] < 0;
  const idx = m.idx.slice();
  if (mirrored) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
  const out: Mesh = { pos: m.pos.map(p => applyPoint(p, x, R)), idx, uv: m.uv.slice() };
  if (m.nrm) out.nrm = m.nrm.map(n => {
    const q = mulMV(R, [n[0] / x.s[0], n[1] / x.s[1], n[2] / x.s[2]]); // inverse-transpose for scale
    const l = Math.hypot(q[0], q[1], q[2]) || 1;
    return [q[0] / l, q[1] / l, q[2] / l];
  });
  return out;
}

// Quaternion [x, y, z, w] for R = Rz·Ry·Rx (glTF node rotation).
export function quatFromEuler(r: Vec3): [number, number, number, number] {
  const q = (axis: 0 | 1 | 2, a: number) => { const v = [0, 0, 0, Math.cos(a / 2)]; v[axis] = Math.sin(a / 2); return v; };
  const mul = (a: number[], b: number[]) => [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
  const out = mul(q(2, r[2]), mul(q(1, r[1]), q(0, r[0])));
  return [out[0], out[1], out[2], out[3]];
}
