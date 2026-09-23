import type { Material, ModelDoc } from "../document";
import type { EnginePart, Mesh, TextureSpec } from "../engine/types";

export const DEFAULT_COLOR = "#b0b0b0";

const defined = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

// One painted texture per textured material, keyed by material name.
export function textureSpecs(doc: ModelDoc): Record<string, TextureSpec> {
  const out: Record<string, TextureSpec> = {};
  for (const [name, m] of Object.entries(doc.materials ?? {})) {
    if (!m.texture) continue;
    const t = m.texture;
    out[name] = defined({ base: m.color, belly: t.belly, pattern: t.pattern, patternColor: t.color, freq: t.scale, seed: t.seed, bumpStrength: t.bump });
  }
  return out;
}

export function enginePart(mesh: Mesh, material: Material | undefined, materialName: string | undefined, extra: { bump?: number; surface?: boolean }): EnginePart {
  return defined({
    mesh,
    color: material?.color ?? DEFAULT_COLOR,
    tex: material?.texture ? materialName : undefined,
    rough: material?.roughness,
    metal: material?.metalness,
    opacity: material?.opacity,
    emissive: material?.emissive,
    bump: extra.bump,
    surf: extra.surface,
  });
}
