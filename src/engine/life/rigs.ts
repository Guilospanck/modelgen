// @ts-nocheck — ported engine; behaviour frozen by test/engine.golden.test.ts
// Rigs in shader space (the shipped model: centred, largest dimension 2,
// +z forward, y up). Built from the model's anchors in model space
// (head/neck/back/tail/claws/teeth/fins, see anchors.js toModelSpace) and the
// mesh itself: hip pivots from clustering the leg points, wing roots from the
// points beyond the body core, the body centre from the bounding box.
//
//   rig({ name, spec, parts, anchors, override })
//     spec      { plan, ...params } — plan is a body plan in clips.js
//               (quad, winged_quad, flyer, perched, cetacean, fish, seahorse,
//               seal, turtle, serpent, kraken, biped); params tune its clips
//     anchors   { slot: { pos, scale } } in model space, may be {}
//     override  hand corrections: head {c, r}, neck, legTop, tailRoot
import * as lib from "../lib";

function stats(groups) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  const pts = [];
  for (const g of groups) for (let i = 0; i < g.pos.length; i += 3) { // sample every 3rd vertex
    const v = g.pos[i]; pts.push(v);
    for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
  }
  const size = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  const ctr = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  let cmx = 0;
  for (const p of pts) if (Math.abs(p[0]) < 0.18 * 2 && Math.abs(p[0]) > cmx) cmx = Math.abs(p[0]);
  return { mn, mx, size, ctr, pts, coreHalfX: Math.min(cmx, 0.36) };
}

const mean = arr => arr.reduce((a, v) => [a[0] + v[0], a[1] + v[1], a[2] + v[2]], [0, 0, 0]).map(v => v / Math.max(arr.length, 1));
const norm = v => { const l = Math.hypot(...v) || 1; return v.map(x => x / l); };

function rig({ name, spec, parts, anchors = {}, override = {} }) {
  const st = stats(lib.assemble(parts));
  const a = anchors;
  const ov = override;
  const R = { name, plan: spec.plan, params: spec, size: st.size, ctr: st.ctr, mn: st.mn, mx: st.mx };

  // Head: below the hat anchor, sized by it; refined by the mouth anchor when present.
  if (ov.head) R.head = ov.head;
  else if (a.head) {
    const s = a.head.scale;
    const c = [a.head.pos[0], a.head.pos[1] - 0.42 * s, a.head.pos[2]];
    if (a.teeth) { c[1] = (a.head.pos[1] + a.teeth.pos[1]) / 2; c[2] = (a.head.pos[2] + a.teeth.pos[2]) / 2 - 0.15 * s; }
    R.head = { c, r: [0.75 * s, 0.7 * s, 0.85 * s] };
  } else if (a.teeth) {
    const s = a.teeth.scale * 3.2;
    R.head = { c: [a.teeth.pos[0], a.teeth.pos[1] + 0.25 * s, a.teeth.pos[2] - 0.55 * s], r: [0.7 * s, 0.6 * s, 0.75 * s] };
  }
  R.neck = ov.neck || (a.neck ? a.neck.pos.slice() : (R.head ? [R.head.c[0], R.head.c[1] - R.head.r[1] * 0.6, R.head.c[2] - R.head.r[2] * 0.8] : null));
  // Jaw hinge from the mouth anchor: back and up into the skull.
  if (a.teeth && R.head) R.jaw = { hinge: [a.teeth.pos[0], a.teeth.pos[1] + 0.12 * R.head.r[1], a.teeth.pos[2] - 0.7 * R.head.r[2]], mouth: a.teeth.pos.slice() };
  // Tail: root between back and tail anchors, direction outward.
  if (a.tail) {
    const back = a.back ? a.back.pos : (R.head ? R.head.c : st.ctr);
    const root = ov.tailRoot || [a.tail.pos[0], a.tail.pos[1] + 0.35 * (back[1] - a.tail.pos[1]), a.tail.pos[2] + 0.35 * (back[2] - a.tail.pos[2])];
    R.tail = { root, dir: norm([a.tail.pos[0] - root[0], a.tail.pos[1] - root[1], a.tail.pos[2] - root[2]]) };
  }
  // Legs: cluster the points below the hip line by side and by front/back.
  const legTop = ov.legTop ?? { quad: 0.5, winged_quad: 0.5, biped: 0.45, perched: 0.3 }[spec.plan];
  if (legTop !== undefined && legTop > 0) {
    const hipY = st.mn[1] + legTop * st.size[1];
    const cand = st.pts.filter(p => p[1] < hipY && Math.abs(p[0]) < st.coreHalfX * 1.3
      && (!R.head || Math.hypot((p[0] - R.head.c[0]) / R.head.r[0], (p[1] - R.head.c[1]) / R.head.r[1], (p[2] - R.head.c[2]) / R.head.r[2]) > 1.1)
      && (!R.tail || (p[2] - R.tail.root[2]) * R.tail.dir[2] < 0.15));
    const zc = mean(cand)[2];
    const legs = [];
    const pairs = spec.plan === "biped" || spec.plan === "perched" ? [[1, 0], [-1, 0]] : [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (const [sx, sz] of pairs) {
      const pts = cand.filter(p => (p[0] < 0 ? -1 : 1) === sx && (sz === 0 || (p[2] < zc ? -1 : 1) === sz));
      if (pts.length < 8) continue;
      const m = mean(pts);
      legs.push({ sx, sz, hip: [m[0], hipY, m[2]], zc, foot: st.mn[1] });
    }
    R.legs = legs; R.hipY = hipY; R.zc = zc;
  }
  // Wings: everything beyond the core, hinged at the root band.
  if (spec.plan === "flyer" || spec.plan === "winged_quad") {
    const rootX = st.coreHalfX * 0.95;
    const band = st.pts.filter(p => Math.abs(p[0]) > rootX && Math.abs(p[0]) < rootX + 0.18);
    const m = mean(band);
    R.wings = { rootX, rootY: m[1], rootZ: m[2], span: st.mx[0] };
  }
  // Fins (cetaceans etc.) from the fins anchor, mirrored.
  if (a.fins) R.fins = { c: a.fins.pos.slice(), r: [a.fins.scale * 1.4, a.fins.scale * 0.9, a.fins.scale * 1.2] };
  if (a.back) R.back = a.back.pos.slice();
  return R;
}

export { rig };
