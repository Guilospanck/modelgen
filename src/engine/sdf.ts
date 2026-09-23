// @ts-nocheck — ported engine; behaviour frozen by test/engine.golden.test.ts
// Implicit-surface (SDF) modeling: creatures are ONE continuous blended body,
// not glued-together parts. Primitives (round-cones along a skeleton, spheres,
// ellipsoids) are combined with a smooth-min so flesh flows into flesh — necks
// blend into torsos, thighs into hips — then a Surface Nets mesher extracts a
// single watertight skin with normals taken from the field gradient.

// ---------- primitives ----------
// prim = {kind, ...params, k?} — k overrides the field's blend radius locally.

function roundCone(a, b, r1, r2, k) {
  return { kind: "rc", a, b, r1, r2, k };
}
function sphere(c, r, k) {
  return { kind: "sp", c, r, k };
}
function ellipsoid(c, s, k) {
  return { kind: "el", c, s, k };
}

// chain: a polyline skeleton with per-point radii → list of round-cone segments.
function chain(pts, radii, k) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) out.push(roundCone(pts[i], pts[i + 1], radii[i], radii[i + 1], k));
  return out;
}

function primDist(p, pr) {
  switch (pr.kind) {
    case "sp": {
      const dx = p[0] - pr.c[0], dy = p[1] - pr.c[1], dz = p[2] - pr.c[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - pr.r;
    }
    case "el": {
      // scaled-sphere approximation — smoothed by the blend anyway
      const dx = (p[0] - pr.c[0]) / pr.s[0], dy = (p[1] - pr.c[1]) / pr.s[1], dz = (p[2] - pr.c[2]) / pr.s[2];
      const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      return (l - 1) * Math.min(pr.s[0], pr.s[1], pr.s[2]);
    }
    default: { // rc: capsule with linearly varying radius
      const ax = pr.b[0] - pr.a[0], ay = pr.b[1] - pr.a[1], az = pr.b[2] - pr.a[2];
      const px = p[0] - pr.a[0], py = p[1] - pr.a[1], pz = p[2] - pr.a[2];
      const denom = ax * ax + ay * ay + az * az || 1e-9;
      let t = (px * ax + py * ay + pz * az) / denom;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = px - ax * t, dy = py - ay * t, dz = pz - az * t;
      return Math.sqrt(dx * dx + dy * dy + dz * dz) - (pr.r1 + (pr.r2 - pr.r1) * t);
    }
  }
}

// polynomial smooth minimum — the "clay blend"
function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Organic surface detail baked into the one surface (no seams possible):
// proper 3D value-noise fBm, not sines.
function hash3(x, y, z, seed) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (z | 0) * 2147483423 + (seed | 0) * 1442695041;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const s = t => t * t * (3 - 2 * t);
  const sx = s(fx), sy = s(fy), sz = s(fz);
  const c = (dx, dy, dz) => hash3(ix + dx, iy + dy, iz + dz, seed);
  const lerp = (a, b, t) => a + (b - a) * t;
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), sx), lerp(c(0, 1, 0), c(1, 1, 0), sx), sy),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), sx), lerp(c(0, 1, 1), c(1, 1, 1), sx), sy),
    sz);
}
function surfNoise(x, y, z) {
  let v = 0, amp = 0.5, f = 5.0;
  for (let o = 0; o < 3; o++) { v += amp * (vnoise3(x * f, y * f, z * f, 91) - 0.5) * 2; amp *= 0.5; f *= 2.1; }
  return v;
}

// Build the field function from prims. kBlend = global clay softness.
function makeField(prims, { kBlend = 0.09, noiseAmp = 0.006 } = {}) {
  return (x, y, z) => {
    const p = [x, y, z];
    let d = 1e9;
    for (const pr of prims) d = smin(d, primDist(p, pr), pr.k || kBlend);
    if (noiseAmp) d += surfNoise(x, y, z) * noiseAmp;
    return d;
  };
}

function primBounds(prims, pad) {
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  const grow = (pt, r) => {
    for (let k = 0; k < 3; k++) {
      mn[k] = Math.min(mn[k], pt[k] - r);
      mx[k] = Math.max(mx[k], pt[k] + r);
    }
  };
  for (const pr of prims) {
    if (pr.kind === "sp") grow(pr.c, pr.r);
    else if (pr.kind === "el") grow(pr.c, Math.max(...pr.s));
    else { grow(pr.a, pr.r1); grow(pr.b, pr.r2); }
  }
  for (let k = 0; k < 3; k++) { mn[k] -= pad; mx[k] += pad; }
  return [mn, mx];
}

// ---------- Surface Nets mesher ----------
// One vertex per sign-changing cell (average of edge crossings), quads across
// every sign-changing grid edge. Watertight, smooth, normals from the gradient.
const CORNERS = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
  [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
const EDGES = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

function meshField(prims, opts = {}) {
  const { res = 64, kBlend = 0.09, noiseAmp = 0.006 } = opts;
  const f = makeField(prims, { kBlend, noiseAmp });
  const [mn, mx] = primBounds(prims, kBlend * 2 + 0.05);
  const ext = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const cell = Math.max(...ext) / res;
  const nx = Math.max(2, Math.ceil(ext[0] / cell)), ny = Math.max(2, Math.ceil(ext[1] / cell)), nz = Math.max(2, Math.ceil(ext[2] / cell));

  // sample corner grid
  const sx = nx + 1, sy = ny + 1, sz = nz + 1;
  const S = new Float32Array(sx * sy * sz);
  const cornerAt = (i, j, k) => [mn[0] + i * cell, mn[1] + j * cell, mn[2] + k * cell];
  for (let k = 0; k < sz; k++)
    for (let j = 0; j < sy; j++)
      for (let i = 0; i < sx; i++)
        S[i + j * sx + k * sx * sy] = f(mn[0] + i * cell, mn[1] + j * cell, mn[2] + k * cell);
  const sample = (i, j, k) => S[i + j * sx + k * sx * sy];

  // one vertex per mixed-sign cell
  const cellVert = new Int32Array(nx * ny * nz).fill(-1);
  const cidx = (i, j, k) => i + j * nx + k * nx * ny;
  const pos = [];
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const vals = CORNERS.map(c => sample(i + c[0], j + c[1], k + c[2]));
        let inside = 0;
        for (const v of vals) if (v < 0) inside++;
        if (inside === 0 || inside === 8) continue;
        let px = 0, py = 0, pz = 0, cnt = 0;
        for (const [a, b] of EDGES) {
          const va = vals[a], vb = vals[b];
          if ((va < 0) === (vb < 0)) continue;
          const t = va / (va - vb);
          const ca = CORNERS[a], cb = CORNERS[b];
          px += i + ca[0] + (cb[0] - ca[0]) * t;
          py += j + ca[1] + (cb[1] - ca[1]) * t;
          pz += k + ca[2] + (cb[2] - ca[2]) * t;
          cnt++;
        }
        cellVert[cidx(i, j, k)] = pos.length;
        pos.push([mn[0] + (px / cnt) * cell, mn[1] + (py / cnt) * cell, mn[2] + (pz / cnt) * cell]);
      }

  // quads across sign-changing edges
  const idx = [];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) { idx.push(a, b, c, a, c, d); } else { idx.push(a, d, c, a, c, b); }
  };
  for (let k = 0; k < sz; k++)
    for (let j = 0; j < sy; j++)
      for (let i = 0; i < sx; i++) {
        const s0 = sample(i, j, k);
        // x-edge
        if (i < nx && j > 0 && k > 0 && j < ny && k < nz) {
          const s1 = sample(i + 1, j, k);
          if ((s0 < 0) !== (s1 < 0))
            quad(cellVert[cidx(i, j - 1, k - 1)], cellVert[cidx(i, j, k - 1)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j - 1, k)], s0 < 0);
        }
        // y-edge
        if (j < ny && i > 0 && k > 0 && i < nx && k < nz) {
          const s1 = sample(i, j + 1, k);
          if ((s0 < 0) !== (s1 < 0))
            quad(cellVert[cidx(i - 1, j, k - 1)], cellVert[cidx(i - 1, j, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i, j, k - 1)], s0 < 0);
        }
        // z-edge
        if (k < nz && i > 0 && j > 0 && i < nx && j < ny) {
          const s1 = sample(i, j, k + 1);
          if ((s0 < 0) !== (s1 < 0))
            quad(cellVert[cidx(i - 1, j - 1, k)], cellVert[cidx(i, j - 1, k)], cellVert[cidx(i, j, k)], cellVert[cidx(i - 1, j, k)], s0 < 0);
        }
      }

  // normals from the field gradient — liquid-smooth shading, no facets
  const h = cell * 0.5;
  const nrm = pos.map(p => {
    const gx = f(p[0] + h, p[1], p[2]) - f(p[0] - h, p[1], p[2]);
    const gy = f(p[0], p[1] + h, p[2]) - f(p[0], p[1] - h, p[2]);
    const gz = f(p[0], p[1], p[2] + h) - f(p[0], p[1], p[2] - h);
    const l = Math.hypot(gx, gy, gz) || 1;
    return [gx / l, gy / l, gz / l];
  });

  // UVs: u along the body (z), v top→bottom (countershading-compatible)
  const uv = pos.map(p => [
    (p[2] - mn[2]) / (ext[2] || 1),
    (mx[1] - p[1]) / (ext[1] || 1),
  ]);

  return { pos, idx, uv, nrm };
}

// Gradient of a field function (central differences), normalized.
function fieldGradient(f, p, h = 0.01) {
  const g = [
    f(p[0] + h, p[1], p[2]) - f(p[0] - h, p[1], p[2]),
    f(p[0], p[1] + h, p[2]) - f(p[0], p[1] - h, p[2]),
    f(p[0], p[1], p[2] + h) - f(p[0], p[1], p[2] - h),
  ];
  const l = Math.hypot(g[0], g[1], g[2]) || 1;
  return [g[0] / l, g[1] / l, g[2] / l];
}

// Newton-walk a point onto the field's zero surface; returns {p, n} or null.
function surfacePoint(f, start) {
  let q = [start[0], start[1], start[2]];
  for (let i = 0; i < 10; i++) {
    const d = f(q[0], q[1], q[2]);
    if (Math.abs(d) < 0.004) return { p: q, n: fieldGradient(f, q) };
    const g = fieldGradient(f, q);
    q = [q[0] - g[0] * d, q[1] - g[1] * d, q[2] - g[2] * d];
  }
  return null;
}

export { roundCone, sphere, ellipsoid, chain, meshField, makeField, fieldGradient, surfacePoint };
