// Extruded text from the built-in font (IBM Plex Sans SemiBold, see font.ts).
// size is the height of capital letters in meters; the text lies in xy, extruded along z and centred.
import earcut from "earcut";
import { FONT, GLYPHS, KERN } from "./font";
import type { Mesh } from "./types";

export type TextSpec = {
  string: string; size: number; depth: number;
  align?: "left" | "center" | "right"; spacing?: number; lineHeight?: number; segments?: number;
};

type Pt = [number, number];

export function missingChars(s: string): string[] {
  return [...new Set([...s].filter(c => c !== "\n" && !GLYPHS[c]))];
}

// Glyph path → closed contours in font units, curves cut into `seg` pieces.
function contours(d: string, seg: number): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const m of d.matchAll(/([MLQCZ])([^MLQCZ]*)/g)) {
    const n = m[2].trim() ? m[2].trim().split(/\s+/).map(Number) : [];
    const last = cur[cur.length - 1];
    if (m[1] === "M") { if (cur.length) out.push(cur); cur = [[n[0], n[1]]]; }
    else if (m[1] === "L") cur.push([n[0], n[1]]);
    else if (m[1] === "Q") for (let i = 1; i <= seg; i++) {
      const t = i / seg, u = 1 - t;
      cur.push([u * u * last[0] + 2 * u * t * n[0] + t * t * n[2], u * u * last[1] + 2 * u * t * n[1] + t * t * n[3]]);
    }
    else if (m[1] === "C") for (let i = 1; i <= seg; i++) {
      const t = i / seg, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
      cur.push([a * last[0] + b * n[0] + c * n[2] + e * n[4], a * last[1] + b * n[1] + c * n[3] + e * n[5]]);
    }
    else { if (cur.length) out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  // Drop repeated points (paths close back onto their start) and slivers.
  return out.map(c => c.filter((p, i) => { const q = c[(i + 1) % c.length]; return p[0] !== q[0] || p[1] !== q[1]; })).filter(c => c.length >= 3);
}

const area = (c: Pt[]) => { let a = 0; for (let i = 0; i < c.length; i++) { const p = c[i], q = c[(i + 1) % c.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
function inside(p: Pt, c: Pt[]) {
  let hit = false;
  for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const [xi, yi] = c[i], [xj, yj] = c[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Outlines and their holes, whichever way the font winds them: a contour inside an odd number of
// others is a hole of the smallest one around it. Outlines come out counter-clockwise, holes clockwise.
function shapes(cs: Pt[][]): { outer: Pt[]; holes: Pt[][] }[] {
  const size = cs.map(c => Math.abs(area(c)));
  const around = cs.map((c, i) => cs.map((_, j) => j).filter(j => j !== i && size[j] > size[i] && inside(c[0], cs[j])));
  const result = new Map<number, { outer: Pt[]; holes: Pt[][] }>();
  cs.forEach((c, i) => { if (around[i].length % 2 === 0) result.set(i, { outer: area(c) > 0 ? c : c.slice().reverse(), holes: [] }); });
  cs.forEach((c, i) => {
    if (around[i].length % 2 === 0) return;
    const parent = around[i].filter(j => result.has(j)).sort((a, b) => size[a] - size[b])[0];
    result.get(parent)?.holes.push(area(c) < 0 ? c : c.slice().reverse());
  });
  return [...result.values()];
}

const CORNER = Math.cos((35 * Math.PI) / 180);

export function text(spec: TextSpec): Mesh {
  const k = spec.size / FONT.capHeight, h = spec.depth / 2, seg = spec.segments ?? 6;
  const lineStep = (spec.lineHeight ?? 1.6) * FONT.capHeight;
  const pos: number[][] = [], idx: number[] = [], uv: number[][] = [];
  const lines = spec.string.split("\n");
  // Caps of the first line down to the baseline of the last, centred on y = 0.
  const top = FONT.capHeight, bottom = -(lines.length - 1) * lineStep, mid = (top + bottom) / 2;

  lines.forEach((line, li) => {
    const chars = [...line];
    const advances = chars.map((c, i) => (GLYPHS[c]?.[0] ?? 0) + (KERN[c + (chars[i + 1] ?? "")] ?? 0) + (spec.spacing ?? 0) * FONT.capHeight);
    const width = advances.reduce((a, b) => a + b, 0) - ((spec.spacing ?? 0) * FONT.capHeight);
    let x = spec.align === "right" ? -width : spec.align === "center" ? -width / 2 : 0;
    const y = -li * lineStep - mid;
    chars.forEach((c, i) => {
      const g = GLYPHS[c];
      if (g) for (const s of shapes(contours(g[1], seg))) {
        const rings = [s.outer, ...s.holes].map(r => r.map(([px, py]): Pt => [(px + x) * k, (py + y) * k]));
        addSolid(rings, h, spec.size, pos, idx, uv);
      }
      x += advances[i];
    });
  });
  return { pos, idx, uv };
}

// One letter piece: front and back caps (earcut, holes included) and side walls. Walls share
// vertices around smooth curves and split them at corners, so curves shade round and corners stay crisp.
function addSolid(rings: Pt[][], h: number, size: number, pos: number[][], idx: number[], uv: number[][]) {
  const flat = rings.flat(), holes: number[] = [];
  let n = 0;
  for (const r of rings.slice(0, -1)) { n += r.length; holes.push(n); }
  const tris = earcut(flat.flat(), holes, 2);
  for (const [z, front] of [[h, true], [-h, false]] as const) {
    const base = pos.length;
    for (const [x, y] of flat) { pos.push([x, y, z]); uv.push([x / size, y / size]); }
    for (let i = 0; i < tris.length; i += 3) {
      let [a, b, c] = [tris[i], tris[i + 1], tris[i + 2]];
      const ccw = (flat[b][0] - flat[a][0]) * (flat[c][1] - flat[a][1]) - (flat[b][1] - flat[a][1]) * (flat[c][0] - flat[a][0]) > 0;
      if (ccw !== front) [b, c] = [c, b];
      idx.push(base + a, base + b, base + c);
    }
  }
  for (const r of rings) {
    const m = r.length;
    const dir = (i: number) => { const p = r[i], q = r[(i + 1) % m], l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; };
    const smooth = r.map((_, i) => { const a = dir((i - 1 + m) % m), b = dir(i); return a[0] * b[0] + a[1] * b[1] > CORNER; });
    // Vertex pairs (front, back) for a point as the end of the edge before it and the start of the edge after it.
    let along = 0;
    const pair = (i: number) => {
      const b = pos.length, [x, y] = r[i];
      pos.push([x, y, h], [x, y, -h]);
      uv.push([along / size, 0], [along / size, (2 * h) / size]);
      return b;
    };
    const start: number[] = [], end: number[] = [];
    for (let i = 0; i < m; i++) {
      start[i] = pair(i);
      end[i] = smooth[i] ? start[i] : pair(i);
      const q = r[(i + 1) % m];
      along += Math.hypot(q[0] - r[i][0], q[1] - r[i][1]);
    }
    // Edge a→b: A/D front/back at a, B/C front/back at b; (A, D, B) and (B, D, C) face outward.
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m, A = start[i], D = start[i] + 1, B = end[j], C = end[j] + 1;
      idx.push(A, D, B, B, D, C);
    }
  }
}
