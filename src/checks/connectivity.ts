import type { EnginePart } from "../engine/types";

// Parts connect if their 12%-shrunk bounding boxes overlap, a sampled vertex of
// one sits inside the other's box, sampled vertices come within 4% of the
// model's size, or (last resort) a sampled vertex of one lies within 0.5% of
// the model's size of a triangle of the other (flush / face-to-face contact).
// Returns connected components (part indices), largest first.
export function components(parts: EnginePart[]): number[][] {
  const boxes = parts.map(p => {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const v of p.mesh.pos) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
    return { mn, mx };
  });
  let size = 0;
  for (const b of boxes) for (let k = 0; k < 3; k++) size = Math.max(size, b.mx[k] - b.mn[k]);
  const eps = size * 0.04;
  const samples = parts.map(p => {
    const st = Math.max(1, Math.floor(p.mesh.pos.length / 400));
    const out: number[][] = [];
    for (let i = 0; i < p.mesh.pos.length; i += st) out.push(p.mesh.pos[i]);
    return out;
  });
  const overlap = (a: typeof boxes[0], b: typeof boxes[0]) => {
    for (let k = 0; k < 3; k++) {
      const sa = (a.mx[k] - a.mn[k]) * 0.12, sb = (b.mx[k] - b.mn[k]) * 0.12;
      if (a.mn[k] + sa > b.mx[k] - sb || b.mn[k] + sb > a.mx[k] - sa) return false;
    }
    return true;
  };
  const embedded = (i: number, j: number) => {
    const b = boxes[j], s = [0, 1, 2].map(k => (b.mx[k] - b.mn[k]) * 0.02);
    for (const v of samples[i]) {
      let inside = true;
      for (let k = 0; k < 3; k++) if (v[k] < b.mn[k] + s[k] || v[k] > b.mx[k] - s[k]) { inside = false; break; }
      if (inside) return true;
    }
    return false;
  };
  const near = (i: number, j: number) => {
    for (const a of samples[i])
      for (const b of samples[j]) {
        const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        if (dx * dx + dy * dy + dz * dz < eps * eps) return true;
      }
    return false;
  };
  const tol = size * 0.005;
  const boxesNear = (a: typeof boxes[0], b: typeof boxes[0]) => {
    for (let k = 0; k < 3; k++) if (a.mn[k] - tol > b.mx[k] || b.mn[k] - tol > a.mx[k]) return false;
    return true;
  };
  // Any sampled vertex of i within tol of a triangle of j.
  const onSurface = (i: number, j: number) => {
    const { pos, idx } = parts[j].mesh;
    for (const v of samples[i]) {
      for (let t = 0; t + 2 < idx.length; t += 3) {
        const a = pos[idx[t]], b = pos[idx[t + 1]], c = pos[idx[t + 2]];
        let far = false;
        for (let k = 0; k < 3; k++) {
          if (v[k] < Math.min(a[k], b[k], c[k]) - tol || v[k] > Math.max(a[k], b[k], c[k]) + tol) { far = true; break; }
        }
        if (!far && pointTriDist2(v, a, b, c) <= tol * tol) return true;
      }
    }
    return false;
  };
  const touch = (i: number, j: number) => boxesNear(boxes[i], boxes[j]) && (onSurface(i, j) || onSurface(j, i));
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++)
      if (find(i) !== find(j) && (overlap(boxes[i], boxes[j]) || embedded(i, j) || embedded(j, i) || near(i, j) || touch(i, j))) parent[find(j)] = find(i);
  const comps = new Map<number, number[]>();
  parts.forEach((_, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r)!.push(i); });
  return [...comps.values()].sort((a, b) => b.length - a.length);
}

// Squared distance from p to triangle abc (closest point on triangle; Ericson, RTCD 5.1.5).
function pointTriDist2(p: number[], a: number[], b: number[], c: number[]): number {
  const sub = (u: number[], v: number[]) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]];
  const dot = (u: number[], v: number[]) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let q: number[];
  if (d1 <= 0 && d2 <= 0) q = a;
  else {
    const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
    if (d3 >= 0 && d4 <= d3) q = b;
    else {
      const vc = d1 * d4 - d3 * d2;
      if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; }
      else {
        const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
        if (d6 >= 0 && d5 <= d6) q = c;
        else {
          const vb = d5 * d2 - d1 * d6;
          if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; }
          else {
            const va = d3 * d6 - d5 * d4;
            if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
              const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
              q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])];
            } else {
              const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
              q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
            }
          }
        }
      }
    }
  }
  const d = sub(p, q);
  return dot(d, d);
}

export function connectivityIssues(parts: EnginePart[]): string | null {
  const comps = components(parts);
  if (comps.length <= 1) return null;
  const stray = comps.slice(1).flat().sort((a, b) => a - b);
  return `${comps.length} components; floating parts: ${stray.map(i => `#${i}(${parts[i].color})`).join(", ")}`;
}
