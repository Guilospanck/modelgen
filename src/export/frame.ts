import { assemble, assembleTransform } from "../engine/lib";
import type { EnginePart, Group } from "../engine/types";

// normalize: recentre + scale the largest side to 2 (assemble's default).
// Otherwise keep the authored frame: invert exactly what assemble did, using
// the same ctr/s (v -> (v - ctr) * s, so the inverse is v -> v / s + ctr).
export function assembleFramed(parts: EnginePart[], normalize: boolean): Group[] {
  const groups: Group[] = assemble(parts);
  if (!normalize) {
    const { ctr, s } = assembleTransform(parts);
    for (const g of groups) g.pos = g.pos.map(p => [p[0] / s + ctr[0], p[1] / s + ctr[1], p[2] / s + ctr[2]]);
  }
  return groups;
}

// The written positions must span the authored bbox (usda writes 3 decimals, so 2e-3 tolerance).
export function roundTripIssue(parts: EnginePart[], shipped: number[][]): string | null {
  const box = (pts: number[][]) => {
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const v of pts) for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
    return { mn, mx };
  };
  const a = box(parts.flatMap(p => p.mesh.pos)), b = box(shipped);
  const bad: string[] = [];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(a.mn[k] - b.mn[k]) > 2e-3) bad.push(`mn[${k}] authored=${a.mn[k]} written=${b.mn[k]}`);
    if (Math.abs(a.mx[k] - b.mx[k]) > 2e-3) bad.push(`mx[${k}] authored=${a.mx[k]} written=${b.mx[k]}`);
  }
  return bad.length ? bad.join("; ") : null;
}
