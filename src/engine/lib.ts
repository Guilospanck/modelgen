// @ts-nocheck — ported engine; behaviour frozen by test/engine.golden.test.ts
// Mesh + texture + USDZ authoring library for the creature model generator.
// Meshes carry UVs; materials can reference procedurally painted PNG textures
// (fur/feathers/scales/spots/stripes) packed into the .usdz alongside the layer.
import * as zlib from "node:zlib";

// ---------- small vector helpers ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = a => Math.hypot(a[0], a[1], a[2]);
const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Deterministic PRNG (mulberry32) so regeneration is reproducible.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cheap organic 3D noise: sum of incommensurate sines.
function noise3(x, y, z) {
  return (
    Math.sin(x * 5.13 + y * 3.71 + z * 4.27) * 0.5 +
    Math.sin(x * 9.71 - y * 7.13 + z * 6.11 + 1.7) * 0.3 +
    Math.sin(-x * 14.3 + y * 11.9 + z * 12.7 + 3.1) * 0.2
  );
}

// ---------- primitive meshes ({pos, idx, uv}) ----------

function uvSphere(segU = 24, segV = 18) {
  const pos = [], idx = [], uv = [];
  for (let v = 0; v <= segV; v++) {
    const phi = (v / segV) * Math.PI;
    for (let u = 0; u <= segU; u++) {
      const th = (u / segU) * 2 * Math.PI;
      pos.push([Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th)]);
      uv.push([u / segU, v / segV]);
    }
  }
  const at = (u, v) => v * (segU + 1) + u;
  for (let v = 0; v < segV; v++)
    for (let u = 0; u < segU; u++) {
      idx.push(at(u, v), at(u + 1, v), at(u + 1, v + 1));
      idx.push(at(u, v), at(u + 1, v + 1), at(u, v + 1));
    }
  return { pos, idx, uv };
}

// Tube swept along a polyline; parallel-transport frames. Each radii entry is a
// number (circular) or [rMajor, rMinor] (elliptical). opts.exp is a superellipse
// exponent: 2 = round, 3-4 = increasingly boxy cross-sections (torsos, muzzles,
// hulls — the antidote to everything looking inflated).
function tube(path, radii, segU = 14, opts = {}) {
  const n = path.length, exp = opts.exp || 2;
  const pos = [], idx = [], uv = [];
  const tans = path.map((p, i) => norm(sub(path[Math.min(i + 1, n - 1)], path[Math.max(i - 1, 0)])));
  let up = Math.abs(dot(tans[0], [0, 1, 0])) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let nvec = norm(cross(up, tans[0]));
  const se = (c) => Math.sign(c) * Math.pow(Math.abs(c), 2 / exp);
  for (let i = 0; i < n; i++) {
    nvec = norm(sub(nvec, scale(tans[i], dot(nvec, tans[i]))));
    const bvec = cross(tans[i], nvec);
    const r = radii[i];
    const ra = Array.isArray(r) ? r[0] : r, rb = Array.isArray(r) ? r[1] : r;
    for (let u = 0; u < segU; u++) {
      const th = (u / segU) * 2 * Math.PI;
      pos.push(add(path[i], add(scale(nvec, se(Math.cos(th)) * ra), scale(bvec, se(Math.sin(th)) * rb))));
      uv.push([u / segU, i / (n - 1)]);
    }
  }
  const at = (i, u) => i * segU + (u % segU);
  for (let i = 0; i < n - 1; i++)
    for (let u = 0; u < segU; u++) {
      idx.push(at(i, u), at(i, u + 1), at(i + 1, u + 1));
      idx.push(at(i, u), at(i + 1, u + 1), at(i + 1, u));
    }
  const c0 = pos.length; pos.push(path[0]); uv.push([0.5, 0]);
  for (let u = 0; u < segU; u++) idx.push(c0, at(0, u + 1), at(0, u));
  const c1 = pos.length; pos.push(path[n - 1]); uv.push([0.5, 1]);
  for (let u = 0; u < segU; u++) idx.push(c1, at(n - 1, u), at(n - 1, u + 1));
  return { pos, idx, uv };
}

// Thin extruded silhouette in XY; planar UVs from the outline bounding box.
function slab(outline, thickness) {
  const m = outline.length, h = thickness / 2;
  const pos = [], idx = [], uv = [];
  let cx = 0, cy = 0, mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
  for (const [x, y] of outline) {
    cx += x; cy += y;
    mnx = Math.min(mnx, x); mny = Math.min(mny, y); mxx = Math.max(mxx, x); mxy = Math.max(mxy, y);
  }
  cx /= m; cy /= m;
  const U = ([x, y]) => [(x - mnx) / (mxx - mnx || 1), (y - mny) / (mxy - mny || 1)];
  for (const p of outline) { pos.push([p[0], p[1], h]); uv.push(U(p)); }
  for (const p of outline) { pos.push([p[0], p[1], -h]); uv.push(U(p)); }
  const cf = pos.length; pos.push([cx, cy, h]); uv.push(U([cx, cy]));
  const cb = pos.length; pos.push([cx, cy, -h]); uv.push(U([cx, cy]));
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    idx.push(cf, i, j);
    idx.push(cb, m + j, m + i);
    idx.push(i, m + i, m + j);
    idx.push(i, m + j, j);
  }
  return { pos, idx, uv };
}

// Wing/fin outline; feather > 0 scallops the trailing edge into feather tips.
function wingOutline(span, rootChord, tipChord, sweep, points = 10, feather = 0) {
  const out = [];
  for (let i = 0; i <= points; i++) {
    const t = i / points;
    out.push([span * t, rootChord / 2 - sweep * t * t + Math.sin(t * Math.PI) * rootChord * 0.08]);
  }
  const n2 = feather ? points * 2 : points;
  for (let i = n2; i >= 0; i--) {
    const t = i / n2;
    const chord = rootChord + (tipChord - rootChord) * t;
    let y = rootChord / 2 - sweep * t * t - chord;
    if (feather && i % 2 === 1) y -= feather * chord;   // feather tip
    out.push([span * t, y]);
  }
  return out;
}

// ---------- transforms ----------

function rotMat(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

function place(mesh, o = {}) {
  const s = o.s === undefined ? [1, 1, 1] : (typeof o.s === "number" ? [o.s, o.s, o.s] : o.s);
  const R = o.r ? rotMat(o.r[0], o.r[1], o.r[2]) : null;
  const t = o.t || [0, 0, 0];
  const pos = mesh.pos.map(p => {
    let q = [p[0] * s[0], p[1] * s[1], p[2] * s[2]];
    if (R) q = [dot(R[0], q), dot(R[1], q), dot(R[2], q)];
    return add(q, t);
  });
  return { pos, idx: mesh.idx.slice(), uv: mesh.uv.slice() };
}

function mirrorX(mesh) {
  const pos = mesh.pos.map(p => [-p[0], p[1], p[2]]);
  const idx = [];
  for (let i = 0; i < mesh.idx.length; i += 3) idx.push(mesh.idx[i], mesh.idx[i + 2], mesh.idx[i + 1]);
  return { pos, idx, uv: mesh.uv.slice() };
}

// Place a mesh with an explicit basis: v' = X*vx + Y*vy + Z*vz + t.
// Used to orient surface tufts/feathers along a groom direction + surface normal.
function placeM(mesh, X, Y, Z, t) {
  const pos = mesh.pos.map(v => [
    X[0] * v[0] + Y[0] * v[1] + Z[0] * v[2] + t[0],
    X[1] * v[0] + Y[1] * v[1] + Z[1] * v[2] + t[1],
    X[2] * v[0] + Y[2] * v[1] + Z[2] * v[2] + t[2],
  ]);
  return { pos, idx: mesh.idx.slice(), uv: mesh.uv.slice() };
}

// ---------- assembly ----------

// part(mesh, color, {tex, rough, metal, opacity, emissive, bump})
function part(mesh, color, opts = {}) { return { mesh, color, ...opts }; }

function computeNormals(pos, idx) {
  const nrm = pos.map(() => [0, 0, 0]);
  for (let i = 0; i < idx.length; i += 3) {
    const a = pos[idx[i]], b = pos[idx[i + 1]], c = pos[idx[i + 2]];
    const fn = cross(sub(b, a), sub(c, a));
    for (const k of [idx[i], idx[i + 1], idx[i + 2]]) {
      nrm[k][0] += fn[0]; nrm[k][1] += fn[1]; nrm[k][2] += fn[2];
    }
  }
  return nrm.map(norm);
}

// The recenter + uniform rescale assemble() applies to the parts' raw
// (undisplaced) vertices: v -> (v - ctr) * s, centre of the bbox to the
// origin, longest side to 2.0.
function assembleTransform(parts) {
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of parts)
    for (const v of p.mesh.pos)
      for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
  const ctr = [0, 1, 2].map(k => (mn[k] + mx[k]) / 2);
  const s = 2.0 / Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  return { ctr, s };
}

// Merge parts by material, apply per-part bump displacement, normalize size,
// compute smooth normals. Group key includes texture id so textured parts and
// plain parts get separate meshes/materials.
function assemble(parts, opts = {}) {
  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of parts)
    for (const v of p.mesh.pos)
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
  // raw: keep the parts' own frame (used for variant overlays already built
  // in the shipped model's space, which must not be re-centred).
  const ctr = opts.raw ? [0, 0, 0] : scale(add(mn, mx), 0.5);
  const s = opts.raw ? 1 : 2.0 / Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);

  const groups = new Map();
  for (const p of parts) {
    // organic bump: radial displacement from part centroid, scaled by noise
    let verts = p.mesh.pos;
    if (p.bump) {
      let c = [0, 0, 0];
      for (const v of verts) c = add(c, v);
      c = scale(c, 1 / verts.length);
      verts = verts.map(v => {
        const d = norm(sub(v, c));
        const n = noise3(v[0] * 6, v[1] * 6, v[2] * 6);
        return add(v, scale(d, n * p.bump));
      });
    }
    const key = `${p.color}|${p.tex || ""}|${p.rough ?? 0.7}|${p.metal ?? 0}|${p.opacity ?? 1}|${p.emissive || ""}`;
    if (!groups.has(key))
      groups.set(key, { color: p.color, tex: p.tex, rough: p.rough ?? 0.7, metal: p.metal ?? 0, opacity: p.opacity ?? 1, emissive: p.emissive, pos: [], idx: [], uv: [], nrm: [] });
    const g = groups.get(key);
    const off = g.pos.length;
    for (const v of verts) g.pos.push(scale(sub(v, ctr), s));
    for (const i of p.mesh.idx) g.idx.push(i + off);
    for (const t of p.mesh.uv) g.uv.push(t);
    // implicit-surface parts carry gradient normals (uniform scale keeps them
    // valid); triangle-built parts get computed normals for their range
    if (p.mesh.nrm) {
      for (const n of p.mesh.nrm) g.nrm.push(n);
    } else {
      const local = computeNormals(verts, p.mesh.idx);
      for (const n of local) g.nrm.push(n);
    }
  }
  return [...groups.values()];
}

// ---------- procedural texture painting ----------

const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, f) => [Math.max(0, Math.min(255, c[0] * f)), Math.max(0, Math.min(255, c[1] * f)), Math.max(0, Math.min(255, c[2] * f))];

// ---- proper fractal noise (value-noise fBm) — kills the sine "corduroy" ----
function hash2(x, y, seed) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 1442695041;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const s = t => t * t * (3 - 2 * t);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy);
}
function fbm(x, y, seed, oct = 4) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { v += amp * vnoise(x * f, y * f, seed + o * 77); amp *= 0.5; f *= 2.03; }
  return v; // ≈ [0, 1)
}

// Paints a W×W RGBA skin texture from a spec:
// { base, belly?, pattern: fur|feathers|scales|spots|stripes|mottle|flame|none,
//   patternColor?, freq?, seed? }
function paintSkin(spec, W = 512, raw = false) {
  const px = Buffer.alloc(W * W * 4);
  const base = hexRGB(spec.base);
  const belly = spec.belly ? hexRGB(spec.belly) : null;
  const pat = spec.patternColor ? hexRGB(spec.patternColor) : shade(base, 0.55);
  const R = rng(spec.seed ?? 7);
  const freq = spec.freq || 1;
  const sd = spec.seed || 7;

  // pattern pre-pass for spots (stamped ellipses)
  let spots = null;
  if (spec.pattern === "spots") {
    spots = new Float32Array(W * W);
    const n = Math.round(90 * freq);
    for (let k = 0; k < n; k++) {
      const cx = R() * W, cy = W * 0.05 + R() * W * 0.75; // keep belly cleaner
      const rx = (2.5 + R() * 4) * (W / 256), ry = rx * (0.7 + R() * 0.6), rot = R() * Math.PI;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      for (let y = Math.max(0, cy - ry * 2) | 0; y < Math.min(W, cy + ry * 2); y++)
        for (let x = Math.max(0, cx - rx * 2) | 0; x < Math.min(W, cx + rx * 2); x++) {
          const dx = x - cx, dy = y - cy;
          const u = (dx * cr + dy * sr) / rx, v = (-dx * sr + dy * cr) / ry;
          const d = u * u + v * v;
          if (d < 1) spots[y * W + x] = Math.max(spots[y * W + x], 1 - d * d);
        }
    }
  }

  const hgt = new Float32Array(W * W); // height field → normal map
  for (let y = 0; y < W; y++) {
    const v = y / W;
    for (let x = 0; x < W; x++) {
      const u = x / W;
      let c = base;
      let hg = 0.5;
      if (belly) c = mix(base, belly, Math.min(1, Math.max(0, (v - 0.55) * 3.2)));
      // macro tone patches — no animal is one flat color
      const macro = fbm(u * 5 * freq, v * 5 * freq, sd, 3);
      c = shade(c, 0.92 + macro * 0.18);

      switch (spec.pattern) {
        case "fur": {
          // layered pelt: directional strands (anisotropic fBm), fine grain
          const strand = fbm(u * 70 * freq, v * 10 * freq, sd + 5, 4);
          const grain = fbm(u * 160 * freq, v * 40 * freq, sd + 9, 2);
          c = shade(c, 0.86 + strand * 0.26 + (grain - 0.5) * 0.1);
          if (strand < 0.32) c = mix(c, pat, 0.25); // dark under-fur showing through
          hg = 0.3 + strand * 0.5 + (grain - 0.5) * 0.25;
          break;
        }
        case "feathers": {
          // shingle rows, each feather its own tone, barb streaks inside
          const row = v * 13 * freq;
          const offs = (Math.floor(row) % 2) * 0.5;
          const col = u * 8 * freq + offs;
          const fid = hash2(Math.floor(col), Math.floor(row), sd);      // per-feather tone
          const fx = col % 1, fy = row % 1;
          c = shade(c, 0.9 + fid * 0.2);
          const arc = fy - 0.5 * Math.sqrt(Math.max(0, 1 - (fx - 0.5) * (fx - 0.5) * 4));
          if (arc > 0.3 && arc < 0.45) c = mix(c, pat, 0.35);           // feather edge
          const barb = fbm(fx * 30, fy * 4, sd + 3, 2);                 // barb streaks
          c = shade(c, 0.95 + barb * 0.1);
          hg = 0.65 - fy * 0.3 + (arc > 0.3 && arc < 0.45 ? -0.2 : 0) + barb * 0.1;
          break;
        }
        case "scales": {
          const row = v * 18 * freq;
          const offs = (Math.floor(row) % 2) * 0.5;
          const col = u * 14 * freq + offs;
          const sid = hash2(Math.floor(col), Math.floor(row), sd);      // per-scale tone
          const fx = col % 1, fy = row % 1;
          const d = Math.hypot(fx - 0.5, fy - 0.5) * 2;
          c = shade(c, 0.88 + sid * 0.22);
          if (d > 0.68 && d < 1.05) c = mix(c, pat, 0.6);               // deep rim
          else c = shade(c, 1 + (0.5 - d) * 0.22);                      // domed highlight
          const wear = fbm(u * 30 * freq, v * 30 * freq, sd + 4, 2);    // weathering
          c = shade(c, 0.95 + wear * 0.1);
          hg = d < 1 ? 0.35 + (1 - d) * 0.55 : 0.3;                     // domed scales
          break;
        }
        case "spots": {
          const sp = spots[y * W + x];
          if (sp > 0) c = mix(c, pat, Math.min(1, sp * 1.25));
          const grain = fbm(u * 90 * freq, v * 24 * freq, sd + 6, 3);
          c = shade(c, 0.92 + grain * 0.16);
          hg = 0.45 + grain * 0.2;
          break;
        }
        case "stripes": {
          const wob = (fbm(u * 5, v * 9, sd + 2, 3) - 0.5) * 0.12;
          const w = Math.sin((u + wob) * Math.PI * 2 * 6 * freq);
          if (w > 0.45) c = mix(c, pat, Math.min(1, (w - 0.45) * 3));
          const grain = fbm(u * 70 * freq, v * 20 * freq, sd + 8, 2);
          c = shade(c, 0.94 + grain * 0.12);
          hg = 0.45 + grain * 0.2;
          break;
        }
        case "mottle": {
          // big soft two-tone patches (seals, stone, weathered hide)
          const m = fbm(u * 7 * freq, v * 7 * freq, sd + 1, 4);
          if (m > 0.55) c = mix(c, pat, Math.min(1, (m - 0.55) * 3.2));
          const grain = fbm(u * 60 * freq, v * 25 * freq, sd + 12, 2);
          c = shade(c, 0.93 + grain * 0.14);
          hg = 0.4 + m * 0.2 + grain * 0.15;
          break;
        }
        case "flame": {
          // living fire: gold crown → orange → crimson, licking tongues
          const gold = hexRGB("#f7d13b"), orange = hexRGB(spec.base), crimson = pat;
          const ramp = Math.min(1, Math.max(0, v + (fbm(u * 6, v * 6, sd, 4) - 0.5) * 0.5));
          c = ramp < 0.4 ? mix(gold, orange, ramp / 0.4) : mix(orange, crimson, (ramp - 0.4) / 0.6);
          const lick = fbm(u * 18, v * 5 - ramp * 2, sd + 7, 4);
          if (lick > 0.62) c = mix(c, gold, Math.min(1, (lick - 0.62) * 2.6));
          hg = 0.35 + lick * 0.4;
          break;
        }
        case "runes": {
          // sparse glyphs: in each cell, one to three short strokes in the
          // pattern colour, over a soft mottled base — magic eggs
          const N = 9 * freq;
          const cx = Math.floor(u * N), cy = Math.floor(v * N);
          const fx = (u * N) % 1, fy = (v * N) % 1;
          const m = fbm(u * 6, v * 6, sd + 1, 3);
          c = shade(c, 0.9 + m * 0.2);
          let glyph = 0;
          const n = 1 + Math.floor(hash2(cx, cy, sd) * 3);
          for (let k = 0; k < n; k++) {
            const h1 = hash2(cx * 7 + k, cy * 3, sd + 2), h2 = hash2(cx, cy * 5 + k, sd + 3);
            const ax = 0.25 + h1 * 0.5, ay = 0.2 + h2 * 0.6;
            const vert = hash2(cx + k, cy, sd + 4) > 0.5;
            const along = vert ? Math.abs(fx - ax) : Math.abs(fy - ay);
            const span = vert ? Math.abs(fy - ay) : Math.abs(fx - ax);
            if (along < 0.045 && span < 0.22) glyph = 1;
          }
          if (glyph) c = pat;
          hg = 0.5 + (glyph ? -0.25 : m * 0.15);
          break;
        }
        default: {
          const grain = fbm(u * 40 * freq, v * 18 * freq, sd + 11, 3);
          c = shade(c, 0.94 + grain * 0.12);
          hg = 0.45 + grain * 0.15;
        }
      }
      const i = (y * W + x) * 4;
      px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
      hgt[y * W + x] = hg;
    }
  }
  if (raw) return { px, W };
  return { diffuse: encodePNG(px, W, W), normal: heightToNormal(hgt, W, spec.bumpStrength ?? 2.2) };
}

// Sobel height→tangent-space normal map.
function heightToNormal(hgt, W, strength) {
  const px = Buffer.alloc(W * W * 4);
  const at = (x, y) => hgt[((y + W) % W) * W + ((x + W) % W)];
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * W + x) * 4;
      px[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
      px[i + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); // +dy: v is flipped into st space by usda
      px[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
      px[i + 3] = 255;
    }
  return encodePNG(px, W, W);
}

// ---------- PNG encoder (RGBA8, zlib, filter 0) ----------

function pngChunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePNG(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- USDA + USDZ writers ----------

function hexToLinear(hex) {
  const c = parseInt(hex.slice(1), 16);
  const f = v => Math.pow(v / 255, 2.2);
  return [f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255)];
}

const f3 = x => (Math.abs(x) < 5e-4 ? 0 : +x.toFixed(3));

// groups → usda text; textured groups reference textures/<tex>.png inside the package.
function usda(groups) {
  const L = [];
  L.push('#usda 1.0\n(\n    defaultPrim = "Root"\n    metersPerUnit = 1\n    upAxis = "Y"\n)\n');
  L.push('def Xform "Root"\n{');
  groups.forEach((g, gi) => {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const v of g.pos) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
    L.push(`    def Mesh "m${gi}" (\n        prepend apiSchemas = ["MaterialBindingAPI"]\n    )\n    {`);
    L.push(`        float3[] extent = [(${f3(mn[0])}, ${f3(mn[1])}, ${f3(mn[2])}), (${f3(mx[0])}, ${f3(mx[1])}, ${f3(mx[2])})]`);
    L.push(`        int[] faceVertexCounts = [${new Array(g.idx.length / 3).fill(3).join(", ")}]`);
    L.push(`        int[] faceVertexIndices = [${g.idx.join(", ")}]`);
    L.push(`        point3f[] points = [${g.pos.map(p => `(${f3(p[0])}, ${f3(p[1])}, ${f3(p[2])})`).join(", ")}]`);
    L.push(`        normal3f[] normals = [${g.nrm.map(p => `(${f3(p[0])}, ${f3(p[1])}, ${f3(p[2])})`).join(", ")}] (\n            interpolation = "vertex"\n        )`);
    L.push(`        texCoord2f[] primvars:st = [${g.uv.map(t => `(${f3(t[0])}, ${f3(1 - t[1])})`).join(", ")}] (\n            interpolation = "vertex"\n        )`);
    L.push('        uniform token subdivisionScheme = "none"');
    L.push('        uniform bool doubleSided = true');
    L.push(`        rel material:binding = </Root/Materials/mat${gi}>`);
    L.push("    }");
  });
  L.push('    def Scope "Materials"\n    {');
  groups.forEach((g, gi) => {
    L.push(`        def Material "mat${gi}"\n        {`);
    L.push(`            token outputs:surface.connect = </Root/Materials/mat${gi}/PBRShader.outputs:surface>`);
    if (g.tex) {
      L.push(`            def Shader "stReader"\n            {`);
      L.push('                uniform token info:id = "UsdPrimvarReader_float2"');
      L.push('                token inputs:varname = "st"');
      L.push("                float2 outputs:result");
      L.push("            }");
      L.push(`            def Shader "diffTex"\n            {`);
      L.push('                uniform token info:id = "UsdUVTexture"');
      L.push(`                asset inputs:file = @textures/${g.tex}.png@`);
      L.push(`                float2 inputs:st.connect = </Root/Materials/mat${gi}/stReader.outputs:result>`);
      L.push('                token inputs:sourceColorSpace = "sRGB"');
      L.push('                token inputs:wrapS = "repeat"');
      L.push('                token inputs:wrapT = "repeat"');
      L.push("                float3 outputs:rgb");
      L.push("            }");
      L.push(`            def Shader "normTex"\n            {`);
      L.push('                uniform token info:id = "UsdUVTexture"');
      L.push(`                asset inputs:file = @textures/${g.tex}_n.png@`);
      L.push(`                float2 inputs:st.connect = </Root/Materials/mat${gi}/stReader.outputs:result>`);
      L.push('                token inputs:sourceColorSpace = "raw"');
      L.push("                float4 inputs:scale = (2, 2, 2, 1)");
      L.push("                float4 inputs:bias = (-1, -1, -1, 0)");
      L.push("                float3 outputs:rgb");
      L.push("            }");
    }
    L.push(`            def Shader "PBRShader"\n            {`);
    L.push('                uniform token info:id = "UsdPreviewSurface"');
    if (g.tex) {
      L.push(`                color3f inputs:diffuseColor.connect = </Root/Materials/mat${gi}/diffTex.outputs:rgb>`);
      L.push(`                normal3f inputs:normal.connect = </Root/Materials/mat${gi}/normTex.outputs:rgb>`);
    } else {
      const [r, gg, b] = hexToLinear(g.color).map(f3);
      L.push(`                color3f inputs:diffuseColor = (${r}, ${gg}, ${b})`);
    }
    if (g.emissive) {
      const [r, gg, b] = hexToLinear(g.emissive).map(f3);
      L.push(`                color3f inputs:emissiveColor = (${r}, ${gg}, ${b})`);
    }
    L.push(`                float inputs:roughness = ${g.rough}`);
    L.push(`                float inputs:metallic = ${g.metal}`);
    L.push(`                float inputs:opacity = ${g.opacity}`);
    L.push("                token outputs:surface");
    L.push("            }");
    L.push("        }");
  });
  L.push("    }");
  L.push("}");
  return L.join("\n") + "\n";
}

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// USDZ: uncompressed multi-entry zip, every entry's data 64-byte aligned.
// entries: [{name, data:Buffer}] — the .usda layer must be first.
function usdz(entries) {
  const chunks = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const dataStart = offset + 30 + name.length;
    const pad = (64 - (dataStart % 64)) % 64;
    const extra = Buffer.alloc(pad);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);            // stored
    local.writeUInt16LE(0x21, 12);        // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(extra.length, 28);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(0, 10);             // stored
    cen.writeUInt16LE(0x21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(e.data.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, name]));

    chunks.push(local, name, extra, e.data);
    offset += 30 + name.length + extra.length + e.data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, cd, eocd]);
}

export {
  uvSphere, tube, slab, wingOutline, place, placeM, mirrorX, part, assemble, assembleTransform,
  paintSkin, usda, usdz, encodePNG, add, sub, scale, norm, rng, fbm,
};
