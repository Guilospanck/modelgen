import { OpError } from "../document/issues";
import { SHAPE_KEYS, type ModelDoc, type Part, type ShapeKey } from "../document/schema";
import * as shapes from "../engine/shapes";
import { tube as tubeMesh } from "../engine/lib";
import * as sdf from "../engine/sdf";
import { text } from "../engine/text";
import type { EnginePart, Mesh, TextureSpec } from "../engine/types";
import { trsOf, transformMesh, type TRS } from "./transform";
import { enginePart, textureSpecs } from "./materials";
import type { ScriptOutput } from "./script";

export type SceneNode = { name: string; shape: ShapeKey; trs: TRS; material?: string; visible: boolean; parts: EnginePart[]; children: SceneNode[] };
export type Compiled = { nodes: SceneNode[]; textures: Record<string, TextureSpec> };
export type FlatPart = { part: EnginePart; owner: string };

export type ScriptRunner = (part: Part) => ScriptOutput;

// Without a runner (the browser build), script parts are reported instead of run.
const noScripts: ScriptRunner = p => {
  const message = `${p.name}: script parts can't run here`;
  throw new OpError(message, [{ severity: "error", code: "script", part: p.name, message, hint: "script parts need the modelgen CLI or MCP server" }]);
};

// Document → node tree. Each node's engine parts are in the node's local space.
export function compileTree(doc: ModelDoc, runScript: ScriptRunner = noScripts): Compiled {
  const textures = textureSpecs(doc);
  const compilePart = (p: Part): SceneNode => {
    const shape = SHAPE_KEYS.find(k => p[k] !== undefined)!;
    const node: SceneNode = { name: p.name, shape, trs: trsOf(p), material: p.material, visible: p.visible !== false, parts: [], children: [] };
    if (p.group) {
      node.children = p.group.parts.map(compilePart);
    } else if (p.script) {
      const out = runScript(p);
      for (const [id, spec] of Object.entries(out.textures)) {
        if (textures[id]) throw new OpError(`${p.name}: texture "${id}" collides with a material or another script`, [{
          severity: "error", code: "script", part: p.name, message: `${p.name}: texture "${id}" collides with a material or another script`, hint: "rename the material or the script's texture id",
        }]);
        textures[id] = spec;
      }
      node.parts = out.parts;
    } else {
      const material = p.material ? doc.materials?.[p.material] : undefined;
      node.parts = [enginePart(shapeMesh(p), material, p.material, { bump: p.bump, surface: p.surface })];
    }
    return node;
  };
  return { nodes: doc.parts.map(compilePart), textures };
}

export function shapeMesh(p: Part): Mesh {
  if (p.box) return shapes.box(p.box.size[0], p.box.size[1], p.box.size[2]);
  if (p.sphere) return shapes.sphere(p.sphere.radius, p.sphere.segments);
  if (p.cylinder) {
    const [top, bottom] = Array.isArray(p.cylinder.radius) ? p.cylinder.radius : [p.cylinder.radius, p.cylinder.radius];
    return shapes.cylinder(top, bottom, p.cylinder.height, p.cylinder.segments);
  }
  if (p.cone) return shapes.cone(p.cone.radius, p.cone.height, p.cone.segments);
  if (p.capsule) return shapes.capsule(p.capsule.radius, p.capsule.length, p.capsule.segments);
  if (p.torus) return shapes.torus(p.torus.radius, p.torus.tube, p.torus.segments);
  if (p.plane) return shapes.plane(p.plane.size[0], p.plane.size[1]);
  if (p.extrude) return shapes.extrude(p.extrude.profile, p.extrude.depth);
  if (p.lathe) return shapes.lathe(p.lathe.profile, p.lathe.segments);
  if (p.tube) {
    const t = p.tube;
    return tubeMesh(t.path, t.radii ?? t.path.map(() => t.radius!), t.segments ?? 14, { exp: t.boxiness ?? 2 });
  }
  if (p.text) return text(p.text);
  if (p.blob) {
    // sdf.ts is untyped JS: its trailing `k` (per-primitive blend override) is optional but reads as required.
    const prims = p.blob.shapes.flatMap((s): unknown[] => {
      if ("sphere" in s) return [sdf.sphere(s.sphere.center, s.sphere.radius, undefined)];
      if ("ellipsoid" in s) return [sdf.ellipsoid(s.ellipsoid.center, s.ellipsoid.radii, undefined)];
      if ("capsule" in s) return [sdf.roundCone(s.capsule.from, s.capsule.to, s.capsule.radius, s.capsule.radiusEnd ?? s.capsule.radius, undefined)];
      return sdf.chain(s.chain.points, s.chain.radii, undefined);
    });
    return sdf.meshField(prims, { res: p.blob.resolution ?? 64, kBlend: p.blob.blend ?? 0.05, noiseAmp: 0 });
  }
  throw new Error(`part "${p.name}" has no mesh shape`);
}

// World-space parts: own transform first, then each ancestor's. Hidden subtrees skipped.
export function flatten(nodes: SceneNode[], ancestors: TRS[] = []): FlatPart[] {
  const out: FlatPart[] = [];
  for (const n of nodes) {
    if (!n.visible) continue;
    const chain = [n.trs, ...ancestors];
    for (const part of n.parts) {
      let mesh = part.mesh;
      for (const x of chain) mesh = transformMesh(mesh, x);
      out.push({ part: mesh === part.mesh ? part : { ...part, mesh }, owner: n.name });
    }
    out.push(...flatten(n.children, chain));
  }
  return out;
}

export function findNode(nodes: SceneNode[], name: string): SceneNode | undefined {
  for (const n of nodes) {
    if (n.name === name) return n;
    const hit = findNode(n.children, name);
    if (hit) return hit;
  }
  return undefined;
}

export function subtreeNames(node: SceneNode): string[] {
  return [node.name, ...node.children.flatMap(subtreeNames)];
}
