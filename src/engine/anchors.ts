// @ts-nocheck — ported engine; behaviour frozen by test/engine.golden.test.ts
// Cosmetic anchor heuristics: where a hat, scarf, saddle, tail ribbon... sits
// on a model, computed from its built parts.
//
// Conventions the heuristics target (every builder should follow them):
// forward = +z, up = +y, ground = y 0, left/right symmetric in x.
//
// anchorsFor() returns anchors in raw part (authoring) space; toModelSpace()
// moves them into the space of the .usdz/.glb that assemble() writes.
//
// Slots: head, neck, back, claws, teeth, tail, fins, companion. Unknown slots
// are skipped. Each anchor is { pos: [x, y, z], scale } — scale is the size a
// ~1.0-nominal accessory should be multiplied by.
import { assembleTransform } from "./lib";


// Gather solid-part vertices (skip surf tufts — they'd bias toward fur tips).
function cloud(parts) {
  const pts = [];
  for (const p of parts) {
    if (p.surf) continue;
    const st = Math.max(1, Math.floor(p.mesh.pos.length / 600));
    for (let i = 0; i < p.mesh.pos.length; i += st) pts.push(p.mesh.pos[i]);
  }
  return pts;
}

function bbox(pts) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const v of pts) for (let k = 0; k < 3; k++) {
    if (v[k] < mn[k]) mn[k] = v[k];
    if (v[k] > mx[k]) mx[k] = v[k];
  }
  return { mn, mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]] };
}

// Centroid of the points inside a normalized-box region [z0..z1]×[y0..y1] of
// the bbox (x is averaged toward 0 by symmetry unless sideMax, which returns
// the +x extreme instead — used for fins; or top, which returns the highest
// point in the selection — used for head/neck/back/fins so the marker lands
// on the dorsal surface instead of the selection's volumetric centroid, which
// for a tube cross-section (neck, spine) sits on the central axis, INSIDE the
// mesh, not on top of it).
function region(pts, b, { z0 = 0, z1 = 1, y0 = 0, y1 = 1, sideMax = false, top = false, xMax = Infinity }) {
  const zi = v => (v[2] - b.mn[2]) / (b.size[2] || 1);
  const yi = v => (v[1] - b.mn[1]) / (b.size[1] || 1);
  const sel = pts.filter(v => zi(v) >= z0 && zi(v) <= z1 && yi(v) >= y0 && yi(v) <= y1 && Math.abs(v[0]) <= xMax);
  if (!sel.length) return null;
  if (sideMax) return sel.reduce((a, v) => (v[0] > a[0] ? v : a), sel[0]).slice();
  if (top) return sel.reduce((a, v) => (v[1] > a[1] ? v : a), sel[0]).slice();
  const c = [0, 0, 0];
  for (const v of sel) for (let k = 0; k < 3; k++) c[k] += v[k];
  return c.map(x => x / sel.length);
}

// Some body plans blow out the bbox in ways the fixed heuristic windows don't
// anticipate — long thin legs push the whole body into the top of the y-range
// (cheetah), folded wings push the z-range far past any actual tail (griffin,
// hippogriff, pegasus, phoenix), tiny tucked feet fall outside the standard
// claws band (hummingbird). Rather than special-case every such creature,
// widen the same window step by step (y first, then z too) until it catches
// real geometry — this only ever engages when the strict window found nothing.
function regionAdaptive(pts, b, opts) {
  let r = region(pts, b, opts);
  if (r) return r;
  const { z0, z1, sideMax, top, xMax } = opts;
  let { y0, y1 } = opts;
  for (let step = 1; step <= 6 && !r; step++) {
    y0 = Math.max(0, opts.y0 - 0.15 * step);
    y1 = Math.min(1, opts.y1 + 0.15 * step);
    r = region(pts, b, { z0, z1, y0, y1, sideMax, top, xMax });
  }
  // the centerline band itself may be too narrow for this creature's build —
  // widen it before giving up on x, so a genuinely absent feature still falls
  // through to the z-widening pass below rather than grabbing a lateral outlier.
  if (!r && xMax !== undefined && xMax < Infinity) {
    r = region(pts, b, { z0, z1, y0: opts.y0, y1: opts.y1, sideMax, top, xMax: xMax * 2.5 });
  }
  for (let step = 1; step <= 6 && !r; step++) {
    const zz0 = Math.max(0, z0 - 0.15 * step);
    const zz1 = Math.min(1, z1 + 0.15 * step);
    r = region(pts, b, { z0: zz0, z1: zz1, y0: 0, y1: 1, sideMax, top, xMax });
  }
  return r;
}

// Robust head-top anchor for a hat/crown. The generic "topmost point in a fixed
// front-upper bbox window" misfired two ways: it grabbed horn/ear/antler tips
// (so the hat floated on the spikes), and on elongated bodies the fixed window
// was empty and the adaptive widening drifted the anchor back onto the neck.
// Instead: take the frontmost ~22% of the ACTUAL solid geometry (that's the
// head, whatever the body length), then a high-but-not-extreme point in it
// (82nd y-percentile, so horns/ears above the skull are ignored) — the crown of
// the skull, where a hat actually sits. x is centered by symmetry.
function headAnchor(pts, b) {
  if (!pts.length) return null;
  const zi = v => (v[2] - b.mn[2]) / (b.size[2] || 1);
  const yi = v => (v[1] - b.mn[1]) / (b.size[1] || 1);
  const xBand = b.size[1] * 0.3;
  let cand = pts.filter(v => Math.abs(v[0]) <= xBand);
  if (cand.length < 12) cand = pts;
  // Where the head sits depends on body orientation: on a HORIZONTAL body (a
  // quadruped, a winged beast, a long fish/bird) it's the front-upper cluster;
  // on an UPRIGHT body (a perched owl/falcon) it's the top of the body — the
  // chest is what's "forward" there, not the head, so forwardness must not vote.
  const horizontal = b.size[2] >= b.size[1] * 1.25;
  const winged = b.size[0] >= b.size[1] * 1.6;   // wingspan dominates width -> a flyer
  let sel;
  if (!horizontal) {
    const ys = cand.map(p => p[1]).slice().sort((a, c) => a - c);
    const yCut = ys[Math.floor(ys.length * 0.80)];           // upright body: top fifth = the head
    sel = cand.filter(v => v[1] >= yCut);
  } else if (winged) {
    // Flyer: the wings/back fill the upper-mid body, but the head is out FRONT
    // at the end of the neck. Take the frontmost centreline geometry only.
    sel = cand.filter(v => zi(v) >= 0.82);
    if (sel.length < 8) sel = cand.filter(v => zi(v) >= 0.72);
  } else {
    sel = cand.filter(v => zi(v) >= 0.6 && zi(v) <= 0.92);   // quadruped: poll, off the nose tip
    if (sel.length < 8) sel = cand.filter(v => zi(v) >= 0.55);
  }
  if (!sel || sel.length < 6) sel = cand;
  // Seat at a high percentile of the head cluster (skip horn/ear/antenna tips),
  // averaging z so it centres on the crown; sink a hair so it never floats.
  const ys = sel.map(p => p[1]).slice().sort((a, c) => a - c);
  const yHi = ys[Math.floor(ys.length * 0.65)];
  const near = sel.filter(p => p[1] >= yHi);
  let y = 0, z = 0;
  for (const p of near) { y += p[1]; z += p[2]; }
  return [0, y / near.length - b.size[1] * 0.03, z / near.length];
}

function anchorsFor(parts, slots, overrides = {}) {
  const pts = cloud(parts);
  const b = bbox(pts);
  const S = Math.max(...b.size);           // model scale (longest axis)
  // Cosmetic sizes key off the BODY core, not raw S: on a winged body the
  // longest axis is the wingspan, which dwarfs the torso a hat/saddle rides on
  // and made scarves and banners balloon. Take the extent of near-centreline
  // geometry (wings/fins sit far out in x, so they drop out), clamped by the
  // height-relative bulk. Quadrupeds/fish are unchanged (their body IS the
  // centreline), flyers shrink to torso size.
  const coreP = pts.filter(v => Math.abs(v[0]) < 0.22 * S);
  const coreB = coreP.length > 20 ? bbox(coreP) : b;
  const bodyScale = Math.min(S, b.size[1] * 2.2, Math.max(...coreB.size));
  // Torso half-width proxy for the "top" picks below: y-extent (height) tracks
  // body bulk reasonably well without blowing up for wingspan (x) or tail/neck
  // length (z) the way S does. Restricting the "topmost point" search to this
  // centerline band keeps a spread wing's folded tip (which reads as the tallest
  // point in the whole cloud) from hijacking the neck/back/head/fins anchor —
  // those slots get re-centered to x=0 anyway, so a wing point off to the side
  // was always the wrong answer even when it was technically "highest".
  const xBand = b.size[1] * 0.16;
  const out = {};
  for (const slot of slots) {
    let pos = null, scale = bodyScale *0.22;
    switch (slot) {
      case "head": {                        // crown of the skull (robust to horns/ears and body length)
        pos = headAnchor(pts, b);
        scale = bodyScale * 0.2;
        break;
      }
      case "neck": {                        // topmost point between head and shoulders (crest/mane line);
        // banded strictly below head's z-window so the two don't collapse onto
        // the same poll/nape vertex once both use "top" instead of a centroid.
        pos = regionAdaptive(pts, b, { z0: 0.5, z1: 0.72, y0: 0.5, y1: 1, top: true, xMax: xBand });
        if (pos) { pos[0] = 0; pos[1] += b.size[1] * 0.03; }
        scale = bodyScale *0.2;
        break;
      }
      case "back": {                        // topmost point of mid-body (spine line);
        // banded below neck's z-window (true mid-back/saddle line, not the withers).
        pos = regionAdaptive(pts, b, { z0: 0.15, z1: 0.45, y0: 0.55, y1: 1, top: true, xMax: xBand });
        if (pos) { pos[0] = 0; pos[1] += b.size[1] * 0.03; }
        scale = bodyScale *0.3;
        break;
      }
      case "claws": {                       // low front — forefeet region
        pos = regionAdaptive(pts, b, { z0: 0.5, z1: 0.85, y0: 0, y1: 0.18 });
        if (pos) pos[0] = 0;
        scale = bodyScale *0.16;
        break;
      }
      case "teeth": {                       // front tip, just below head height
        pos = regionAdaptive(pts, b, { z0: 0.9, z1: 1, y0: 0.35, y1: 0.8 });
        if (pos) { pos[0] = 0; pos[2] = b.mx[2]; }
        scale = bodyScale *0.12;
        break;
      }
      case "tail": {                        // rear tip
        pos = regionAdaptive(pts, b, { z0: 0, z1: 0.12, y0: 0.1, y1: 0.9 });
        if (pos) pos[0] = 0;
        scale = bodyScale *0.16;
        break;
      }
      case "fins": {                        // topmost point on the dorsal midline
        pos = regionAdaptive(pts, b, { z0: 0.35, z1: 0.65, y0: 0.6, y1: 1, top: true, xMax: xBand });
        if (pos) { pos[0] = 0; pos[1] += b.size[1] * 0.03; }
        scale = bodyScale *0.18;
        break;
      }
      case "companion": {                   // floats just beside the head, off to +x
        // Anchor to the HEAD, not the bbox x-extreme — on a winged/long body the
        // extreme is a wingtip or tail-tip, which flung the companion far away.
        const h = headAnchor(pts, b) || [0, b.mn[1] + b.size[1] * 0.8, b.mn[2] + b.size[2] * 0.8];
        pos = [Math.max(bodyScale * 0.28, b.size[0] * 0.12), h[1] + b.size[1] * 0.04, h[2]];
        scale = bodyScale *0.2;
        break;
      }
    }
    const ov = overrides[slot];
    if (ov) out[slot] = ov;
    else if (pos) out[slot] = { pos: pos.map(x => +x.toFixed(4)), scale: +scale.toFixed(4) };
  }
  return out;
}

// Push raw-space anchors (from anchorsFor) through the same recenter +
// uniform rescale assemble() bakes into the shipped mesh, so they land where
// the matching vertices land. Mutates and returns `anchors`.
function toModelSpace(anchors, parts) {
  const { ctr, s } = assembleTransform(parts);
  for (const slot of Object.keys(anchors)) {
    const a = anchors[slot];
    a.pos = a.pos.map((x, k) => +(((x - ctr[k]) * s).toFixed(4)));
    a.scale = +((a.scale * s).toFixed(4));
  }
  return anchors;
}

export const SLOTS = ["head", "neck", "back", "claws", "teeth", "tail", "fins", "companion"];
export { anchorsFor, toModelSpace };
