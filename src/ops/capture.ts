import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { preview, project } from "../engine/render";
import { assembleTransform } from "../engine/lib";
import { OpError, type Issue } from "../document";
import { flatten, findNode } from "../scene/compile";
import { checkScene } from "../checks";
import type { Workspace } from "./workspace";
import { compileFor, opError, readModel, slug } from "./load";

type View = [number, number];
// yaw 0 looks at the model's front (+z faces the camera); pitch looks down.
export const VIEW_PRESETS: Record<string, View[]> = {
  default: [[205, 15], [270, 5], [155, 30]],
  turntable: [0, 45, 90, 135, 180, 225, 270, 315].map(y => [y, 15] as View),
  front: [[0, 5]], side: [[270, 5]], back: [[180, 5]], top: [[0, 80]],
};

export type CaptureResult = {
  model: string;
  image: { path: string; width: number; height: number; views: View[] };
  png: Buffer;
  parts: { name: string; views: { x: number; y: number; inFrame: boolean }[] }[];
  bounds: { min: number[]; max: number[] };
  issues: Issue[];
};

function resolveViews(v: string | View[] | undefined): View[] {
  if (v === undefined) return VIEW_PRESETS.default;
  if (typeof v === "string") {
    if (VIEW_PRESETS[v]) return VIEW_PRESETS[v];
    throw opError("invalid_views", `unknown view preset "${v}"`, `presets: ${Object.keys(VIEW_PRESETS).join(", ")}, or a list of [yaw, pitch] in degrees`);
  }
  if (!Array.isArray(v) || v.length < 1 || v.length > 12 || v.some(x => !Array.isArray(x) || x.length !== 2 || !x.every(Number.isFinite)))
    throw opError("invalid_views", "views must be 1–12 [yaw, pitch] pairs in degrees", "e.g. [[0, 5], [90, 5]]");
  return v;
}

export function capture(ws: Workspace, input: { model: string; part?: string; views?: string | View[]; size?: number }): CaptureResult {
  const views = resolveViews(input.views);
  const size = input.size ?? 360;
  if (!Number.isInteger(size) || size < 64 || size > 1024) throw opError("invalid_size", "size must be an integer between 64 and 1024");
  const { file, doc } = readModel(ws, input.model);
  const compiled = compileFor(file, doc);
  let roots = compiled.nodes;
  if (input.part !== undefined) {
    const n = findNode(roots, input.part);
    if (!n) throw opError("not_found", `no part named "${input.part}"`, "inspect_model lists the part names");
    roots = [n];
  }
  const flat = flatten(roots);
  const issues = checkScene(flat);
  if (flat.length === 0) throw new OpError("nothing to capture", issues);

  const parts = flat.map(f => f.part);
  const png: Buffer = preview({ parts, textures: compiled.textures }, { W: size, H: size, views });
  const { ctr, s } = assembleTransform(parts);
  const boxes = new Map<string, { min: number[]; max: number[] }>();
  for (const { part, owner } of flat) for (const v of part.mesh.pos) {
    const b = boxes.get(owner) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], v[k]); b.max[k] = Math.max(b.max[k], v[k]); }
    boxes.set(owner, b);
  }
  const positions = [...boxes].map(([name, b]) => {
    const c = [0, 1, 2].map(k => ((b.min[k] + b.max[k]) / 2 - ctr[k]) * s);
    return {
      name,
      views: views.map(([yaw, pitch], i) => {
        const p = project(c, size, size, yaw, pitch);
        return { x: Math.round(p.x + i * size), y: Math.round(p.y), inFrame: p.x >= 0 && p.x < size && p.y >= 0 && p.y < size };
      }),
    };
  });
  const all = [...boxes.values()];
  const bounds = { min: [0, 1, 2].map(k => Math.min(...all.map(b => b.min[k]))), max: [0, 1, 2].map(k => Math.max(...all.map(b => b.max[k]))) };

  mkdirSync(ws.previewsDir, { recursive: true });
  const path = join(ws.previewsDir, `${doc.name}${input.part !== undefined ? "." + slug(input.part) : ""}.png`);
  writeFileSync(path, png);
  return { model: doc.name, image: { path, width: size * views.length, height: size, views }, png, parts: positions, bounds, issues };
}
