"use strict";
// A tiny deformation DSL that runs two ways from one program: evaluated in
// JS (so frames can be rendered and judged here) and emitted as a Metal
// snippet for SceneKit's geometry shader modifier (so the app plays the very
// same motion). Expressions are written once, in the scalar subset that is
// valid in both languages: sin/cos/abs/fract/smoothstep/clamp/min/max/mix/
// step/floor/sqrt/pow/sign, the variables t and cyc, mask names, earlier
// lets, and p0.x/p0.y/p0.z (the undeformed position) or p.x/p.y/p.z.
//
// Program statements:
//   { mask, ellipsoid: { c: [x,y,z], r: [rx,ry,rz], soft?: [inner, outer] } }
//   { mask, halfspace: { o: [x,y,z], d: [dx,dy,dz], ramp: [from, to] } }
//   { mask, expr }                      // any scalar expression
//   { let: name, expr }                 // scalar
//   { rot: "x"|"y"|"z", angle, pivot?: [x,y,z], weight? }
//   { move: [ex, ey, ez], weight? }     // p += weight * vec
//   { squash: [sx, sy, sz], pivot?, weight? } // p = pivot + (p-pivot) * mix(1, s, weight)

const FUNCS = {
  sin: Math.sin, cos: Math.cos, abs: Math.abs, floor: Math.floor, sqrt: Math.sqrt, pow: Math.pow,
  min: Math.min, max: Math.max, sign: Math.sign,
  fract: x => x - Math.floor(x),
  step: (e, x) => (x < e ? 0 : 1),
  clamp: (x, a, b) => Math.min(Math.max(x, a), b),
  mix: (a, b, u) => a + (b - a) * u,
  smoothstep: (a, b, x) => { const u = Math.min(Math.max((x - a) / (b - a), 0), 1); return u * u * (3 - 2 * u); },
};

const compiled = new Map();
function fn(expr) {
  const k = String(expr);
  if (!compiled.has(k)) compiled.set(k, new Function("ctx", `with (ctx) { return (${k}); }`));
  return compiled.get(k);
}
const num = v => (typeof v === "number" ? v : fn(v));
const evalv = (v, ctx) => (typeof v === "number" ? v : fn(v)(ctx));

// Metal wants float literals; turn bare integers into floats (leaves p0.x, w_head2 alone).
const lit = e => String(e).replace(/(?<![\w.])(\d+)(?![\w.])/g, "$1.0");
const f3 = v => `float3(${lit(v[0])}, ${lit(v[1])}, ${lit(v[2])})`;

function rotate(v, axis, a) {
  const c = Math.cos(a), s = Math.sin(a);
  switch (axis) {
    case "x": return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
    case "y": return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
    default: return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
  }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/// Deform one vertex. `p`, `n` are arrays; returns [p', n'].
function run(program, p, n, t) {
  const ctx = Object.create(FUNCS);
  ctx.t = t; ctx.cyc = (t / 16 - Math.floor(t / 16)) * 16;
  ctx.p0 = { x: p[0], y: p[1], z: p[2] };
  ctx.p = { x: p[0], y: p[1], z: p[2] };
  let P = p.slice(), N = n.slice();
  const sync = () => { ctx.p.x = P[0]; ctx.p.y = P[1]; ctx.p.z = P[2]; };
  for (const st of program) {
    if (st.mask !== undefined) {
      let w;
      if (st.ellipsoid) {
        const { c, r, soft = [0.8, 1.25] } = st.ellipsoid;
        const d = Math.hypot((P[0] - c[0]) / r[0], (P[1] - c[1]) / r[1], (P[2] - c[2]) / r[2]);
        w = 1 - FUNCS.smoothstep(soft[0], soft[1], d);
      } else if (st.halfspace) {
        const { o, d, ramp = [0, 0.2] } = st.halfspace;
        w = FUNCS.smoothstep(ramp[0], ramp[1], dot(sub([ctx.p0.x, ctx.p0.y, ctx.p0.z], o), d));
      } else w = evalv(st.expr, ctx);
      ctx[st.mask] = w;
    } else if (st.let !== undefined) {
      ctx[st.let] = evalv(st.expr, ctx);
    } else if (st.rot) {
      const w = st.weight === undefined ? 1 : evalv(st.weight, ctx);
      const a = evalv(st.angle, ctx) * w;
      if (a !== 0) {
        const piv = st.pivot ? st.pivot.map(v => evalv(v, ctx)) : [0, 0, 0];
        P = add(rotate(sub(P, piv), st.rot, a), piv);
        N = rotate(N, st.rot, a);
        sync();
      }
    } else if (st.move) {
      const w = st.weight === undefined ? 1 : evalv(st.weight, ctx);
      P = [P[0] + w * evalv(st.move[0], ctx), P[1] + w * evalv(st.move[1], ctx), P[2] + w * evalv(st.move[2], ctx)];
      sync();
    } else if (st.squash) {
      const w = st.weight === undefined ? 1 : evalv(st.weight, ctx);
      const piv = st.pivot ? st.pivot.map(v => evalv(v, ctx)) : [0, 0, 0];
      const s = st.squash.map(v => 1 + (evalv(v, ctx) - 1) * w);
      P = [piv[0] + (P[0] - piv[0]) * s[0], piv[1] + (P[1] - piv[1]) * s[1], piv[2] + (P[2] - piv[2]) * s[2]];
      sync();
    }
  }
  const len = Math.hypot(N[0], N[1], N[2]) || 1;
  return [P, [N[0] / len, N[1] / len, N[2] / len]];
}

/// The same program as Metal, for the body of a SceneKit geometry modifier
/// that has already declared `t`, `p` (float3) and `n` (float3).
function emit(program) {
  const L = ["float3 p0 = p;", "float cyc = fract(t / 16.0) * 16.0;"];
  let uid = 0;
  const declared = new Set(["p0", "cyc", "p", "n", "t"]);
  const def = (name, expr) => { const first = !declared.has(name); declared.add(name); return `${first ? "float " : ""}${name} = ${expr};`; };
  const spin = (axis, v, c, s) => {
    switch (axis) {
      case "x": return `${v} = float3(${v}.x, ${c} * ${v}.y - ${s} * ${v}.z, ${s} * ${v}.y + ${c} * ${v}.z);`;
      case "y": return `${v} = float3(${c} * ${v}.x + ${s} * ${v}.z, ${v}.y, -${s} * ${v}.x + ${c} * ${v}.z);`;
      default: return `${v} = float3(${c} * ${v}.x - ${s} * ${v}.y, ${s} * ${v}.x + ${c} * ${v}.y, ${v}.z);`;
    }
  };
  for (const st of program) {
    if (st.mask !== undefined) {
      if (st.ellipsoid) {
        const { c, r, soft = [0.8, 1.25] } = st.ellipsoid;
        uid++;
        L.push(`float3 dv${uid} = (p0 - ${f3(c)}) / ${f3(r)};`);
        L.push(def(st.mask, `1.0 - smoothstep(${lit(soft[0])}, ${lit(soft[1])}, length(dv${uid}))`));
      } else if (st.halfspace) {
        const { o, d, ramp = [0, 0.2] } = st.halfspace;
        L.push(def(st.mask, `smoothstep(${lit(ramp[0])}, ${lit(ramp[1])}, dot(p0 - ${f3(o)}, ${f3(d)}))`));
      } else L.push(def(st.mask, lit(st.expr)));
    } else if (st.let !== undefined) {
      L.push(def(st.let, lit(st.expr)));
    } else if (st.rot) {
      uid++;
      const a = `a${uid}`, c = `c${uid}`, s = `s${uid}`;
      const w = st.weight === undefined ? "" : ` * (${lit(st.weight)})`;
      L.push(`float ${a} = (${lit(st.angle)})${w};`);
      L.push(`float ${c} = cos(${a}); float ${s} = sin(${a});`);
      if (st.pivot) L.push(`p = p - ${f3(st.pivot)};`);
      L.push(spin(st.rot, "p", c, s));
      L.push(spin(st.rot, "n", c, s));
      if (st.pivot) L.push(`p = p + ${f3(st.pivot)};`);
    } else if (st.move) {
      const w = st.weight === undefined ? "" : `(${lit(st.weight)}) * `;
      L.push(`p = p + ${w}${f3(st.move)};`);
    } else if (st.squash) {
      uid++;
      const w = st.weight === undefined ? "1.0" : `(${lit(st.weight)})`;
      const piv = st.pivot ? f3(st.pivot) : "float3(0.0, 0.0, 0.0)";
      L.push(`float3 sq${uid} = 1.0 + (${f3(st.squash)} - 1.0) * ${w};`);
      L.push(`p = ${piv} + (p - ${piv}) * sq${uid};`);
    }
  }
  return L.join("\n");
}

/// Static checks on an emitted program: no duplicate declarations, no
/// undeclared identifiers, balanced parentheses, no bare integer literals
/// in function arguments. Returns a list of problems (empty = clean).
function lint(metal) {
  const problems = [];
  const known = new Set(["float", "float3", "sin", "cos", "abs", "fract", "smoothstep", "clamp", "min", "max", "mix", "step",
    "floor", "sqrt", "pow", "sign", "length", "dot", "normalize", "p", "n", "t", "x", "y", "z"]);
  const declared = new Set();
  metal.split("\n").forEach((row, i) => row.split(";").map(x => x.trim()).filter(Boolean).forEach(line => {
    const d = /^float(?:3)?\s+(\w+)\s*=/.exec(line);
    if (d) { if (declared.has(d[1])) problems.push(`line ${i + 1}: '${d[1]}' declared twice`); declared.add(d[1]); }
    const opens = (line.match(/\(/g) || []).length, closes = (line.match(/\)/g) || []).length;
    if (opens !== closes) problems.push(`line ${i + 1}: unbalanced parentheses`);
    const body = d ? line.slice(line.indexOf("=") + 1) : line;
    for (const id of body.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)) {
      if (!known.has(id[1]) && !declared.has(id[1])) problems.push(`line ${i + 1}: '${id[1]}' used before declaration`);
    }
    if (/(?<![\w.])\d+(?![\w.])/.test(body)) problems.push(`line ${i + 1}: bare integer literal`);
  }));
  return problems;
}

module.exports = { run, emit, lint, FUNCS };
