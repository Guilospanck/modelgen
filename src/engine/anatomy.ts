// @ts-nocheck — ported engine; behaviour frozen by test/engine.golden.test.ts
// Shared anatomy toolkit for the per-creature builders.
import * as lib from "./lib";
import * as sdf from "./sdf";
const { uvSphere, tube, slab, wingOutline, place, mirrorX, part } = lib;
const { roundCone, sphere: sph, ellipsoid, chain, meshField } = sdf;


const S = (s, o) => place(uvSphere(), { ...o, s });
const both = (mesh) => [mesh, mirrorX(mesh)];
const EYE = "#101014";

function eyes(P, pos, r, glow) {
  for (const m of both(S(r, { t: pos }))) P.push(part(m, EYE, { rough: 0.12, emissive: glow }));
}

// Serrated crest/mane slab along a path on the symmetry plane.
function crest(path, h, thickness = 0.05) {
  const out = [];
  for (const p of path) out.push([p[2], p[1] - 0.14]);
  for (let i = path.length - 1; i >= 0; i--) {
    const p = path[i];
    const endTaper = 0.35 + 0.65 * Math.sin(Math.PI * (i / (path.length - 1)) * 0.92 + 0.08); // no rod-spikes at the ends
    const hh = h * (0.72 + 0.28 * Math.sin(i * 2.1)) * endTaper;
    out.push([p[2] + 0.02, p[1] + hh]);
    if (i > 0) {
      const q = path[i - 1];
      out.push([(p[2] + q[2]) / 2, (p[1] + q[1]) / 2 + hh * 0.3]);
    }
  }
  return place(slab(out, thickness), { r: [0, -Math.PI / 2, 0] });
}

// Three talons at a paw position (x mirrored).
function clawsAt(P, x, y, z, r, color) {
  for (const dx of [-r * 0.5, 0, r * 0.5])
    for (const m of both(tube([[x + dx, y, z], [x + dx, y - r * 0.4, z + r * 0.9]], [r * 0.18, 0.004], 6)))
      P.push(part(m, color, { rough: 0.3 }));
}

// Feathered wing pair (unchanged: membranes/feathers meet bodies at a crease).
function wings(P, o) {
  const { span = 1.6, chord = 0.55, sweep = 0.5, dihedral = 0.18, y = 0.2, z = 0.14,
          color, tipColor, tex, feather = 0.28, slots = 0 } = o;
  const rootX = -0.08;
  const innerSpan = span * 0.48, outerSpan = span * 0.6;
  const inner = slab(wingOutline(innerSpan, chord, chord * 0.85, sweep * 0.25, 8, feather * 0.6), 0.05);
  const outer = slab(wingOutline(outerSpan, chord * 0.88, chord * 0.3, sweep, 10, feather), 0.04);
  for (const m of both(place(inner, { r: [Math.PI / 2 + 0.16, 0, dihedral], t: [rootX, y, z] })))
    P.push(part(m, color, { tex }));
  const d = innerSpan * 0.78;
  const dh2 = dihedral * 1.7;
  const mount = [rootX + d * Math.cos(dihedral), y + d * Math.sin(dihedral), z - sweep * 0.25 * 0.6 - 0.04];
  for (const m of both(place(outer, { r: [Math.PI / 2 + 0.1, 0, dh2], t: mount })))
    P.push(part(m, tipColor || color, { tex }));
  // slotted primaries: separated finger feathers fanning off the wingtip
  if (slots > 0) {
    const d2 = outerSpan * 0.72;
    const tip = [mount[0] + d2 * Math.cos(dh2), mount[1] + d2 * Math.sin(dh2), mount[2] - sweep * 0.4];
    for (let k = 0; k < slots; k++) {
      const f = slab(wingOutline(span * 0.26, chord * 0.13, 0.02, sweep * (0.7 + k * 0.55), 5, 0), 0.03);
      for (const m of both(place(f, { r: [Math.PI / 2 + 0.08, 0, dh2 + 0.06 * k], t: [tip[0], tip[1], tip[2] - k * chord * 0.1] })))
        P.push(part(m, tipColor || color, { tex }));
    }
  }
}

// Tail silhouettes: fan (default), wedge (corvid diamond), pointed, fork.
function tailOutline(shape, tailW, tailL) {
  const w = tailW, L = tailL;
  switch (shape) {
    case "wedge": return [[-w * 0.2, 0.18], [w * 0.2, 0.18], [w * 0.5, -L * 0.55], [0, -L], [-w * 0.5, -L * 0.55]];
    case "pointed": return [[-w * 0.42, 0.18], [w * 0.42, 0.18], [w * 0.12, -L * 0.72], [0, -L], [-w * 0.12, -L * 0.72]];
    case "fork": return [[-w * 0.5, 0.18], [w * 0.5, 0.18], [w * 0.44, -L], [w * 0.14, -L * 0.42], [-w * 0.14, -L * 0.42], [-w * 0.44, -L]];
    default: return [[-w / 2, 0.18], [w / 2, 0.18], [w * 0.4, -L * 0.7], [w * 0.2, -L], [0, -L * 0.8], [-w * 0.2, -L], [-w * 0.4, -L * 0.7]];
  }
}

function batWings(P, { span = 1.7, chord = 0.8, y = 0.3, z = 0.1, color, tex }) {
  const outline = [
    [-0.1, chord * 0.4],
    [0, chord * 0.45], [span * 0.45, chord * 0.5], [span, chord * 0.1],
    [span * 0.92, -chord * 0.35], [span * 0.6, -chord * 0.28],
    [span * 0.45, -chord * 0.5], [span * 0.18, -chord * 0.4], [-0.1, -chord * 0.4],
  ];
  const w = slab(outline, 0.045);
  for (const m of both(place(w, { r: [Math.PI / 2 - 0.18, -0.35, 0.55], t: [0.05, y, z] }))) P.push(part(m, color, { tex, rough: 0.85 }));
}

// ---------- implicit body cores ----------

// Four legs (or 8) as blended chains, both sides. Returns prims + paw info.
function legPrims(prims, { pairsZ, x, hipY, legL, legR, rows = 1 }) {
  const paws = [];
  for (let row = 0; row < rows; row++)
    for (const zp of pairsZ) {
      const zz = zp - row * 0.22;
      for (const s of [1, -1]) {
        prims.push(...chain(
          [[x * s, hipY, zz], [x * s, hipY - legL * 0.5, zz - 0.04], [x * s, hipY - legL * 0.88, zz], [x * s, hipY - legL, zz + legR * 1.1]],
          [legR * 1.7, legR * 0.95, legR * 0.6, legR * 0.8])); // slim ankle, visible paw
      }
      paws.push([x, hipY - legL, zz + legR * 1.1]);
    }
  return paws;
}

// Quadruped: spine + neck + head + snout + legs + tail — one blended field.
// Proportions tuned against rendered previews: slimmer barrel held high on
// longer legs, a real neck, level forward muzzle.
function quadCore(P, o) {
  const {
    color, bodyL = 1.3, bodyR = 0.42, legL = 0.95, legR = 0.1,
    neckL = 0.5, neckA = 0.9, headR = 0.24, snout = 0.28, snoutR = 0.12,
    tailL = 0.7, tailR = 0.07, tailUp = 0.3, legRows = 1, tex, eyeGlow, claws,
    kBlend = 0.075, noEyes = false, rough,
  } = o;
  const prims = [];
  const L = bodyL, R = bodyR;
  // spine: chest deep, waist tucked, held high so the legs read long
  const spineR = [0.58, 0.9, 0.78, 0.7, 0.78, 0.52].map(f => f * R);
  const spinePts = spineR.map((_, i) => [0, R * 0.35 + 0.04 * Math.sin((i / 5) * Math.PI), L / 2 - (L * i) / 5]);
  prims.push(...chain(spinePts, spineR));
  // neck: rises from the withers to a clearly separate head
  const nBase = [0, R * 0.5, L / 2 - 0.22];
  const nEnd = [0, nBase[1] + neckL * Math.sin(neckA), nBase[2] + 0.06 + neckL * Math.cos(neckA)];
  prims.push(...chain([nBase, [0, (nBase[1] + nEnd[1]) / 2 + 0.03, (nBase[2] + nEnd[2]) / 2], nEnd],
    [R * 0.52, R * 0.32, headR * 0.72]));
  const headP = [0, nEnd[1] + headR * 0.3, nEnd[2] + headR * 0.45];
  prims.push(sph(headP, headR));
  if (snout) prims.push(roundCone([headP[0], headP[1] - 0.02, headP[2] + headR * 0.35],
    [headP[0], headP[1] - 0.035, headP[2] + headR * 0.45 + snout], snoutR, snoutR * 0.55, 0.04));
  // legs: high hips, slim ankles
  const hipY = R * 0.1;
  const paws = legPrims(prims, { pairsZ: [L / 2 - 0.26, -(L / 2 - 0.28)], x: R * 0.55, hipY, legL, legR, rows: legRows });
  // tail
  if (tailL) {
    const tp = [[0, R * 0.35, -L / 2 + 0.1]];
    for (let i = 0; i <= 5; i++) { const t = i / 5; tp.push([0, R * 0.3 + tailUp * t * t - 0.1 * t, -L / 2 - tailL * t]); }
    prims.push(...chain(tp, tp.map((_, i) => (i === 0 ? tailR * 1.5 : tailR * (1.15 - i / 7)))));
  }
  P.push(part(meshField(prims, { kBlend }), color, { tex, rough }));
  if (!noEyes) eyes(P, [headR * 0.52, headP[1] + headR * 0.3, headP[2] + headR * 0.55], headR * 0.17, eyeGlow);
  if (snout) P.push(part(S([snoutR * 0.42, snoutR * 0.32, snoutR * 0.4], { t: [0, headP[1] - 0.03, headP[2] + headR * 0.45 + snout - 0.03] }), "#1c1416", { rough: 0.4 }));
  if (claws) for (const pw of paws) clawsAt(P, pw[0], pw[1] + legR * 0.3, pw[2] + legR * 0.6, legR, claws);
  // mane: crest along the ACTUAL neck top (axis + local radius), withers → poll
  if (o.mane) {
    const mp = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const ax = [nBase[0] + (nEnd[0] - nBase[0]) * t, nBase[1] + (nEnd[1] - nBase[1]) * t, nBase[2] + (nEnd[2] - nBase[2]) * t];
      mp.push([ax[0], ax[1] + (R * 0.55 + (headR * 0.8 - R * 0.55) * t) + 0.05, ax[2] - 0.05]); // clear of the neck surface
    }
    P.push(part(crest(mp, o.mane.h || 0.3, o.mane.th || 0.06), o.mane.color, { tex: o.mane.tex, emissive: o.mane.emissive }));
  }
  // hackles: crest along the actual spine top
  if (o.hackles) {
    const hp = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      hp.push([0, R * 0.35 + 0.04 * Math.sin(t * Math.PI) + spineR[Math.round(t * 5)] + 0.03, L / 2 - 0.25 - (L - 0.55) * t]);
    }
    P.push(part(crest(hp, o.hackles.h || 0.14, o.hackles.th || 0.05), o.hackles.color, { tex: o.hackles.tex }));
  }
  headP.prims = prims; // expose the skeleton for coat()
  return headP;
}

// Slab ears rooted at the head — big enough to actually read.
function earsAt(P, h, headR, size, color, tex) {
  const s = size * 1.9;
  for (const m of both(place(slab([[0, -0.1], [0.03, s], [0.09, s * 0.88], [0.14, -0.1]], 0.045),
    { r: [-0.2, 0, 0.35], t: [headR * 0.45, h[1] + headR * 0.4, h[2] - 0.08] })))
    P.push(part(m, color, { tex }));
}

// Bird: teardrop body + neck + head, one field. Returns head position.
function birdCore(P, o) {
  const {
    color, size = 1, beakL = 0.22, beakR = 0.07, beakColor = "#e2a03f",
    headR = 0.26, upright = 0.25, tex, eyeGlow, kBlend = 0.07,
  } = o;
  const prims = [];
  const L = 1.25 * size;
  const rr = [0.42, 0.9, 1.0, 0.76, 0.4].map(f => f * 0.4 * size);
  const pts = rr.map((_, i) => {
    const t = i / 4;
    return [0, (0.16 - 0.36 * t) * size * Math.sin(upright), L / 2 - L * t];
  });
  prims.push(...chain(pts, rr));
  // a real neck lifting the head clear of the body
  const headP = [0, 0.55 * size, 0.62 * size];
  prims.push(...chain([[0, 0.14 * size, 0.4 * size], [0, 0.38 * size, 0.54 * size], headP],
    [0.2 * size, 0.15 * size, headR * size * 0.7]));
  prims.push(sph(headP, headR * size));
  P.push(part(meshField(prims, { kBlend }), color, { tex }));
  // beak: thick at the skull, sharp tip — must READ in silhouette
  P.push(part(tube([[0, headP[1] - 0.02, headP[2] + headR * size * 0.2], [0, headP[1] - 0.06, headP[2] + headR * size * 0.6 + beakL]],
    [[beakR * size * 1.6, beakR * size * 1.3], [0.012, 0.01]], 8, { exp: 2.6 }), beakColor, { rough: 0.35 }));
  eyes(P, [headR * size * 0.55, headP[1] + headR * size * 0.25, headP[2] + headR * size * 0.55], headR * size * 0.17, eyeGlow);
  headP.prims = prims; // expose the skeleton for coat()
  return headP;
}

function birdTail(P, o) {
  const { size = 1, tailL = 0.5, tailW = 0.3, color, tex, shape = "fan" } = o;
  const tail = slab(tailOutline(shape, tailW, tailL), 0.04);
  P.push(part(place(tail, { r: [Math.PI / 2 - 0.35, 0, 0], t: [0, 0.02, -0.42 * size] }), color, { tex }));
}

// Swept-back head crest (crested birds).
function headCrest(P, h, size, color, opts = {}) {
  const c = slab([[-0.02, -0.06], [0.02, size], [0.12, size * 0.85], [0.2, -0.02]], 0.03);
  P.push(part(place(c, { r: [0, -Math.PI / 2, -0.5], t: [0, h[1] + 0.1, h[2] - 0.08] }), color, opts));
}

// Cetacean: one fluid fusiform field; fins as slabs.
function cetaceanCore(P, o) {
  const {
    color, bodyL = 1.6, bodyR = 0.38, snout = 0.2, dorsal = 0.35,
    flukeW = 0.75, flipperL = 0.4, flukeVertical = false, tex, rough = 0.35, eyeGlow,
  } = o;
  const prims = [];
  const N = 8;
  const pts = [], rr = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push([0, 0.02 * Math.sin(t * Math.PI), bodyL / 2 - bodyL * t]);
    rr.push(bodyR * Math.sin(Math.PI * Math.min(0.14 + t * 0.86, 1)) ** 0.7 * (1 - t * 0.5) + 0.015);
  }
  prims.push(...chain(pts, rr));
  if (snout) prims.push(roundCone([0, 0, bodyL / 2 - 0.1], [0, -0.02, bodyL / 2 + snout], bodyR * 0.45, 0.04, 0.06));
  P.push(part(meshField(prims, { kBlend: 0.1, noiseAmp: 0.003 }), color, { tex, rough }));
  eyes(P, [bodyR * 0.58, 0.08, bodyL / 2 - 0.1], bodyR * 0.12, eyeGlow);
  if (dorsal)
    P.push(part(place(slab([[0, -0.15], [0.05, dorsal], [0.28, dorsal], [0.42, dorsal * 0.25], [0.5, -0.15]], 0.04), { r: [0, -Math.PI / 2, 0], t: [0, bodyR * 0.72, 0.15] }), color, { rough }));
  const fluke = slab([[0, 0.28], [flukeW / 2, 0.16], [flukeW / 2 + 0.06, 0], [flukeW / 2, -0.1], [0, -0.02], [-flukeW / 2, -0.1], [-flukeW / 2 - 0.06, 0], [-flukeW / 2, 0.16]], 0.04);
  P.push(part(place(fluke, { r: flukeVertical ? [0, Math.PI / 2, Math.PI / 2] : [Math.PI / 2, 0, 0], t: [0, 0.02, -bodyL / 2 + 0.05] }), color, { rough }));
  for (const m of both(place(slab([[-0.12, 0.07], [flipperL, 0.02], [flipperL * 0.9, -0.07], [-0.12, -0.07]], 0.035), { r: [Math.PI / 2 + 0.4, 0, -0.3], t: [bodyR * 0.55, -bodyR * 0.25, bodyL * 0.18] })))
    P.push(part(m, color, { rough }));
  return { prims };
}

// ---------- creatures ----------

const B = (parts, textures) => ({ parts, textures });

// ---------- surface coats: real fur/feather geometry, not just texture ----------
// Distributes small tuft/feather slabs ON the implicit surface of `prims`,
// oriented by the surface normal and a groom direction, tips lifted slightly.
// This is what breaks the smooth-balloon silhouette into visible pelt/plumage.
//
// opts: { count, seed, len, width, lift (rad), groom: [x,y,z] flow direction,
//         region: p => bool (filter in builder space), colorFn or color, tex,
//         kBlend (must match the body field), shape: "tuft"|"feather" }
function coat(P, prims, opts) {
  const {
    count = 120, seed = 5, len = 0.16, width = 0.07, lift = 0.35,
    groom = [0, -0.35, -1], region = () => true, color, colorFn, tex,
    kBlend = 0.075, shape = "tuft", opacity,
  } = opts;
  const f = sdf.makeField(prims, { kBlend, noiseAmp: 0 });
  const R = lib.rng(seed);
  // candidate seeds: random points around random skeleton primitives
  const centers = [];
  for (const pr of prims) {
    if (pr.kind === "sp" || pr.kind === "el") centers.push([pr.c, pr.kind === "sp" ? pr.r : Math.max(...pr.s)]);
    else { centers.push([pr.a, pr.r1]); centers.push([pr.b, pr.r2]); centers.push([[(pr.a[0] + pr.b[0]) / 2, (pr.a[1] + pr.b[1]) / 2, (pr.a[2] + pr.b[2]) / 2], (pr.r1 + pr.r2) / 2]); }
  }
  const nrm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const crossP = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dotP = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const outline = shape === "feather"
    ? [[-width / 2, 0], [-width * 0.42, len * 0.6], [0, len], [width * 0.42, len * 0.6], [width / 2, 0]]
    : [[-width / 2, 0], [-width * 0.15, len * 0.7], [0, len], [width * 0.15, len * 0.7], [width / 2, 0]];
  const base = lib.slab(outline, 0.016);

  let placed = 0, tries = 0;
  while (placed < count && tries < count * 12) {
    tries++;
    const [c, r] = centers[Math.floor(R() * centers.length)];
    const dir = nrm3([R() * 2 - 1, R() * 2 - 1, R() * 2 - 1]);
    const sp = sdf.surfacePoint(f, [c[0] + dir[0] * r * 1.4, c[1] + dir[1] * r * 1.4, c[2] + dir[2] * r * 1.4]);
    if (!sp || !region(sp.p)) continue;
    const n = sp.n;
    // groom direction projected onto the surface
    let g = [groom[0] - n[0] * dotP(groom, n), groom[1] - n[1] * dotP(groom, n), groom[2] - n[2] * dotP(groom, n)];
    const gl = Math.hypot(g[0], g[1], g[2]);
    if (gl < 0.15) continue;
    g = [g[0] / gl, g[1] / gl, g[2] / gl];
    // tip lifted off the surface
    const cl = Math.cos(lift), sl = Math.sin(lift);
    const Y = nrm3([g[0] * cl + n[0] * sl, g[1] * cl + n[1] * sl, g[2] * cl + n[2] * sl]);
    const X = nrm3(crossP(Y, n));
    const Z = nrm3(crossP(X, Y));
    const t = [sp.p[0] - n[0] * 0.02, sp.p[1] - n[1] * 0.02, sp.p[2] - n[2] * 0.02];
    const jitter = 0.85 + R() * 0.4;
    const mesh = lib.placeM(lib.place(base, { s: jitter }), X, Y, Z, t);
    P.push(part(mesh, colorFn ? colorFn(R) : color, { tex, opacity, surf: true }));
    placed++;
  }
  return placed;
}

export {
  uvSphere, tube, slab, wingOutline, place, mirrorX, part,
  roundCone, sph, ellipsoid, chain, meshField,
  S, both, EYE, eyes, crest, clawsAt, wings, batWings, tailOutline, birdTail,
  headCrest, legPrims, quadCore, earsAt, birdCore, cetaceanCore, B, coat,
};
