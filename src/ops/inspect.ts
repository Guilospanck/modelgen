import { statSync } from "node:fs";
import { SHAPE_KEYS, type Part } from "../document";
import { flatten, findNode, type SceneNode } from "../scene/compile";
import type { Workspace } from "./workspace";
import { historyDepth } from "./history";
import { compileFor, opError, readModel } from "./load";

export type Bounds = { min: number[]; max: number[] };
export type PartInfo = {
  name: string; shape: string; params?: unknown; material?: string; visible: boolean;
  position?: number[]; rotation?: number[]; scale?: number | number[];
  bounds?: Bounds; children?: PartInfo[];
};

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
const union = (a: Bounds | undefined, b: Bounds | undefined): Bounds | undefined =>
  !a ? b : !b ? a : { min: a.min.map((v, k) => Math.min(v, b.min[k])), max: a.max.map((v, k) => Math.max(v, b.max[k])) };

export function inspectModel(ws: Workspace, input: { model: string; part?: string }) {
  const { file, doc } = readModel(ws, input.model);
  const compiled = compileFor(file, doc);

  // world bounds per owning part
  const own = new Map<string, Bounds>();
  for (const { part, owner } of flatten(compiled.nodes)) {
    for (const v of part.mesh.pos) {
      const b = own.get(owner) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], v[k]); b.max[k] = Math.max(b.max[k], v[k]); }
      own.set(owner, b);
    }
  }
  const docParts = new Map<string, Part>();
  const index = (ps: Part[]) => ps.forEach(p => { docParts.set(p.name, p); if (p.group) index(p.group.parts); });
  index(doc.parts);

  const info = (n: SceneNode): PartInfo & { _b?: Bounds } => {
    const p = docParts.get(n.name)!;
    const children = n.children.map(info);
    const b = children.reduce<Bounds | undefined>((acc, c) => union(acc, c.bounds), own.get(n.name));
    const shapeKey = SHAPE_KEYS.find(k => p[k] !== undefined)!;
    return {
      name: n.name, shape: shapeKey,
      ...(shapeKey !== "group" ? { params: p[shapeKey] } : {}),
      ...(p.material ? { material: p.material } : {}),
      visible: n.visible,
      ...(p.position ? { position: p.position } : {}), ...(p.rotation ? { rotation: p.rotation } : {}), ...(p.scale !== undefined ? { scale: p.scale } : {}),
      ...(b && n.visible ? { bounds: { min: b.min.map(r4), max: b.max.map(r4) } } : {}),
      ...(children.length ? { children } : {}),
    };
  };

  let nodes = compiled.nodes;
  if (input.part !== undefined) {
    const n = findNode(compiled.nodes, input.part);
    if (!n) throw opError("not_found", `no part named "${input.part}"`, `parts: ${[...docParts.keys()].join(", ")}`);
    nodes = [n];
  }
  const parts = nodes.map(info);
  const bounds = parts.reduce<Bounds | undefined>((acc, p) => union(acc, p.bounds), undefined);
  return {
    model: input.model, path: file, bytes: statSync(file).size, normalize: doc.normalize === true,
    materials: doc.materials ?? {}, parts, ...(bounds ? { bounds } : {}),
    ...(doc.anchors ? { anchors: doc.anchors } : {}), ...(doc.life ? { life: doc.life } : {}),
    history: historyDepth(ws, input.model),
  };
}
