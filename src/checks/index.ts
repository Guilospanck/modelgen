import type { Issue } from "../document";
import type { FlatPart } from "../scene/tree";
import { components } from "./connectivity";

export function checkScene(flat: FlatPart[]): Issue[] {
  if (flat.length === 0) {
    return [{ severity: "error", code: "empty", message: "the model has no visible geometry", hint: "add parts with edit_model, or make hidden parts visible" }];
  }
  const issues: Issue[] = [];
  const bad = new Set<string>();
  for (const { part, owner } of flat) {
    const m = part.mesh;
    if (m.idx.length < 3 || m.pos.some(v => v.some(c => !Number.isFinite(c)))) bad.add(owner);
  }
  for (const owner of bad) {
    issues.push({ severity: "error", code: "degenerate", part: owner, message: `"${owner}" has no usable geometry`, hint: "check its sizes, profile and path" });
  }

  // Floating: same rule as always — surface detail (surf) is attached by construction.
  const solid = flat.filter(f => !f.part.surf && !bad.has(f.owner));
  if (solid.length > 1) {
    const comps = components(solid.map(f => f.part));
    if (comps.length > 1) {
      const main = comps[0];
      const stray = new Map<string, number[]>();
      for (const i of comps.slice(1).flat()) stray.set(solid[i].owner, [...(stray.get(solid[i].owner) ?? []), i]);
      for (const [owner, idxs] of stray) {
        const near = nearest(solid, idxs, main);
        issues.push({
          severity: "error", code: "floating", part: owner,
          message: `"${owner}" is not touching the rest of the model`,
          hint: near
            ? `move it until it touches or overlaps another part — nearest is "${near.owner}", ${near.dist.toFixed(3)} away`
            : "move it until it touches or overlaps another part",
        });
      }
    }
  }
  return issues;
}

// Closest part (by sampled vertices) in `to` from any part in `from`.
function nearest(solid: FlatPart[], from: number[], to: number[]): { owner: string; dist: number } | null {
  const sample = (i: number) => {
    const pos = solid[i].part.mesh.pos, st = Math.max(1, Math.floor(pos.length / 200));
    const out: number[][] = [];
    for (let k = 0; k < pos.length; k += st) out.push(pos[k]);
    return out;
  };
  let best: { owner: string; dist: number } | null = null;
  for (const i of from) {
    const a = sample(i);
    for (const j of to) for (const q of sample(j)) for (const p of a) {
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      if (!best || d < best.dist) best = { owner: solid[j].owner, dist: d };
    }
  }
  return best;
}
