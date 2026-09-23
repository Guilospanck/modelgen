import type { EnginePart } from "../engine/types";

// Parts connect if their 12%-shrunk bounding boxes overlap, a sampled vertex of
// one sits inside the other's box, or sampled vertices come within 4% of the
// model's size. Returns connected components (part indices), largest first.
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
  const parent = parts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++)
      if (find(i) !== find(j) && (overlap(boxes[i], boxes[j]) || embedded(i, j) || embedded(j, i) || near(i, j))) parent[find(j)] = find(i);
  const comps = new Map<number, number[]>();
  parts.forEach((_, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r)!.push(i); });
  return [...comps.values()].sort((a, b) => b.length - a.length);
}

export function connectivityIssues(parts: EnginePart[]): string | null {
  const comps = components(parts);
  if (comps.length <= 1) return null;
  const stray = comps.slice(1).flat().sort((a, b) => a - b);
  return `${comps.length} components; floating parts: ${stray.map(i => `#${i}(${parts[i].color})`).join(", ")}`;
}
