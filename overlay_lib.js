"use strict";
// Shared by variants.js and stages.js: vector helpers, area-weighted surface
// sampling with normals, and a tangent basis at a point.
const { rng } = require("./lib");

// ---------- vector bits ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = v => { const l = Math.hypot(...v) || 1; return mul(v, 1 / l); };
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => c.map(v => Math.max(0, Math.min(255, v * k)));
const hash = (x, y, s) => { const v = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return v - Math.floor(v); };


/// Area-weighted random points on the body's surface with interpolated normals.
function sampleSurface(groups, n, seed, filter = () => true) {
  const R = rng(seed);
  const tris = [];
  let total = 0;
  for (const g of groups) {
    if (g.idx.length / 3 < 150 || g.opacity < 1) continue; // skip eyes, claws, glass
    for (let i = 0; i < g.idx.length; i += 3) {
      const a = g.pos[g.idx[i]], b = g.pos[g.idx[i + 1]], c = g.pos[g.idx[i + 2]];
      const area = Math.hypot(...cross(sub(b, a), sub(c, a))) / 2;
      if (area > 0) { total += area; tris.push({ g, i, cum: total }); }
    }
  }
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 40) {
    const r = R() * total;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (tris[m].cum < r) lo = m + 1; else hi = m; }
    const { g, i } = tris[lo];
    let u = R(), v = R(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    const ia = g.idx[i], ib = g.idx[i + 1], ic = g.idx[i + 2];
    const p = add(add(mul(g.pos[ia], w), mul(g.pos[ib], u)), mul(g.pos[ic], v));
    const nn = norm(add(add(mul(g.nrm[ia] || [0, 1, 0], w), mul(g.nrm[ib] || [0, 1, 0], u)), mul(g.nrm[ic] || [0, 1, 0], v)));
    if (filter(p, nn, R)) out.push({ p, n: nn });
  }
  return out;
}

function basis(n, R) {
  const t0 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let X = norm(cross(t0, n)), Z = cross(n, X);
  const a = R() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
  const X2 = add(mul(X, ca), mul(Z, sa)), Z2 = add(mul(X, -sa), mul(Z, ca));
  return { X: X2, Y: n, Z: Z2 };
}


module.exports = { add, sub, mul, dot, cross, norm, hex, mixc, shade, hash, sampleSurface, basis };
