import { assemble, assembleTransform } from "../engine/lib";
import { anchorsFor, toModelSpace } from "../engine/anchors";
import { rig } from "../engine/life/rigs";
import { program } from "../engine/life/clips";
import { emit, lint } from "../engine/life/dsl";
import { OpError, type Issue, type ModelDoc } from "../document";
import { flatten, findNode, type Compiled, type FlatPart, type SceneNode } from "../scene/compile";
import { quatFromEuler } from "../scene/transform";
import { checkScene } from "../checks";
import { paintSkins } from "./skins";
import { writeUsdz, validateUsdz, readUsda, parseUsdaPoints } from "./usdz";
import { glbScene, validateGlb, type GlbNode } from "./glb";
import { assembleFramed, roundTripIssue } from "./frame";
import type { TextureSpec } from "../engine/types";

export type Format = "usdz" | "glb";
export const FORMATS: Format[] = ["usdz", "glb"];
export type ExportedFile = { format: Format; data: Buffer };
export type Anchor = { pos: number[]; scale: number };

export function exportModelFiles(doc: ModelDoc, compiled: Compiled, formats: Format[], opts: { part?: string } = {}): { files: ExportedFile[]; issues: Issue[] } {
  let roots: SceneNode[] = compiled.nodes;
  if (opts.part !== undefined) {
    const node = findNode(compiled.nodes, opts.part);
    if (!node) throw new OpError(`no part named "${opts.part}"`, [{ severity: "error", code: "not_found", message: `no part named "${opts.part}"`, hint: "inspect_model lists the part names" }]);
    roots = [node];
  }
  const flat = flatten(roots);
  const issues = checkScene(flat);
  if (issues.some(i => i.severity === "error")) return { files: [], issues };

  const parts = flat.map(f => f.part);
  const normalize = opts.part === undefined && doc.normalize === true;
  let textures: Record<string, TextureSpec> = compiled.textures;
  if (opts.part !== undefined) {
    const used = new Set(parts.map(p => p.tex).filter(Boolean));
    textures = Object.fromEntries(Object.entries(textures).filter(([id]) => used.has(id)));
  }
  const skins = paintSkins(textures);
  const files: ExportedFile[] = [];

  for (const format of formats) {
    if (format === "usdz") {
      const data = writeUsdz(assembleFramed(parts, normalize), skins);
      if (!normalize) {
        const rt = roundTripIssue(parts, parseUsdaPoints(readUsda(data)));
        if (rt) issues.push({ severity: "error", code: "frame", message: `usdz positions drifted from the authored frame: ${rt}` });
      }
      for (const m of validateUsdz(data, Object.keys(skins).length * 2 + 1)) issues.push({ severity: "error", code: "usdz_structure", message: m });
      files.push({ format, data });
    } else {
      const toGlb = (n: SceneNode): GlbNode => ({
        name: n.name, translation: n.trs.t, rotation: quatFromEuler(n.trs.r), scale: n.trs.s,
        groups: n.parts.length ? assemble(n.parts, { raw: true }) : undefined,
        children: n.children.filter(c => c.visible).map(toGlb),
      });
      let top: GlbNode[] = roots.filter(n => n.visible).map(toGlb);
      if (opts.part === undefined) {
        const root: GlbNode = { name: doc.name, children: top };
        if (normalize) {
          const { ctr, s } = assembleTransform(parts);
          root.scale = [s, s, s];
          root.translation = [-ctr[0] * s, -ctr[1] * s, -ctr[2] * s];
        }
        top = [root];
      }
      const data = glbScene(top, skins);
      for (const m of validateGlb(data)) issues.push({ severity: "error", code: "glb_structure", message: m });
      files.push({ format, data });
    }
  }
  return issues.some(i => i.severity === "error") ? { files: [], issues } : { files, issues };
}

// Anchors in the exported model's space (normalized space when normalize is on).
export function modelAnchors(doc: ModelDoc, flat: FlatPart[]): Record<string, Anchor> | undefined {
  if (!doc.anchors) return undefined;
  const parts = flat.map(f => f.part);
  const raw = anchorsFor(parts, doc.anchors.slots, doc.anchors.overrides ?? {});
  return doc.normalize ? toModelSpace(raw, parts) : raw;
}

export function modelLife(doc: ModelDoc, flat: FlatPart[], anchors: Record<string, Anchor> | undefined):
  { entry: { plan: string; metal: string }; problems: string[] } | undefined {
  if (!doc.life) return undefined;
  const spec = { plan: doc.life.plan, ...(doc.life.params ?? {}) };
  const R = rig({ name: doc.name, spec, parts: flat.map(f => f.part), anchors: anchors ?? {}, override: doc.life.override ?? {} });
  const metal: string = emit(program(R));
  return { entry: { plan: doc.life.plan, metal }, problems: lint(metal) };
}
