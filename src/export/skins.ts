import { paintSkin } from "../engine/lib";
import type { Skin, TextureSpec } from "../engine/types";

// Paint every texture once (512×512 diffuse + normal PNGs).
export function paintSkins(textures: Record<string, TextureSpec>): Record<string, Skin> {
  const out: Record<string, Skin> = {};
  for (const [id, spec] of Object.entries(textures)) out[id] = paintSkin(spec) as Skin;
  return out;
}
