import { DocSchema, SHAPE_KEYS, type ModelDoc, type Part } from "./schema";
import type { Issue } from "./issues";

export function formatPath(path: readonly PropertyKey[]): string {
  let s = "";
  for (const k of path) s += typeof k === "number" ? `[${k}]` : (s ? "." : "") + String(k);
  return s || "(document)";
}

const HINTS: Record<string, string> = {
  invalid_type: "check the value's type (`modelgen describe schema`)",
  unrecognized_keys: "remove the key or fix its spelling (`modelgen describe shapes` lists every field)",
  too_small: "the value is below the minimum allowed",
  too_big: "the value is above the maximum allowed",
  invalid_union: "blob shapes are one of: sphere, ellipsoid, capsule, chain",
  invalid_format: "see `modelgen describe conventions`",
  invalid_value: "see `modelgen describe` for the allowed values",
};

export function validateDocument(raw: unknown): { doc?: ModelDoc; issues: Issue[] } {
  const r = DocSchema.safeParse(raw);
  if (!r.success) {
    const issues: Issue[] = r.error.issues.map(i => {
      const where = formatPath(i.path);
      const keys = (i as { keys?: string[] }).keys;
      const what = keys ? `unknown key${keys.length > 1 ? "s" : ""} ${keys.map(k => `"${k}"`).join(", ")}` : i.message;
      return { severity: "error", code: "schema", path: where, message: `${where}: ${what}`, hint: HINTS[i.code] };
    });
    return { issues };
  }
  const issues = semantic(r.data);
  return issues.some(i => i.severity === "error") ? { issues } : { doc: r.data, issues };
}

function semantic(doc: ModelDoc): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, string>();
  const materials = Object.keys(doc.materials ?? {});
  const e = (path: string, part: string | undefined, message: string, hint?: string) =>
    issues.push({ severity: "error", code: "invalid", path, part, message: `${path}: ${message}`, ...(hint ? { hint } : {}) });

  const walk = (parts: Part[], base: string) => parts.forEach((p, i) => {
    const at = `${base}[${i}]`;
    const shapes = SHAPE_KEYS.filter(k => p[k] !== undefined);
    if (shapes.length === 0) e(at, p.name, "has no shape", `add exactly one of: ${SHAPE_KEYS.join(", ")}`);
    if (shapes.length > 1) e(at, p.name, `has more than one shape (${shapes.join(", ")})`, "split it into separate parts");
    if (seen.has(p.name)) e(`${at}.name`, p.name, `"${p.name}" is already used at ${seen.get(p.name)}`, "part names must be unique within a model");
    else seen.set(p.name, at);
    if (p.material !== undefined && !materials.includes(p.material))
      e(`${at}.material`, p.name, `unknown material "${p.material}"`, materials.length ? `define it under materials, or use one of: ${materials.join(", ")}` : "define it under materials first");
    if (Array.isArray(p.scale) && p.scale.some(v => v === 0)) e(`${at}.scale`, p.name, "scale components can't be 0");
    if (p.tube) {
      const t = p.tube;
      if (t.radius === undefined && t.radii === undefined) e(`${at}.tube`, p.name, "needs radius or radii");
      if (t.radius !== undefined && t.radii !== undefined) e(`${at}.tube`, p.name, "use radius or radii, not both");
      if (t.radii && t.radii.length !== t.path.length)
        e(`${at}.tube.radii`, p.name, `has ${t.radii.length} entries but path has ${t.path.length} points`, "give one radius per path point");
    }
    if (p.lathe && p.lathe.profile.some(([r]) => r < 0)) e(`${at}.lathe.profile`, p.name, "radius (first value of each point) can't be negative");
    if (p.blob) p.blob.shapes.forEach((s, j) => {
      if ("chain" in s && s.chain.radii.length !== s.chain.points.length) e(`${at}.blob.shapes[${j}].chain.radii`, p.name, "needs one radius per point");
    });
    if (p.group) walk(p.group.parts, `${at}.group.parts`);
  });

  walk(doc.parts, "parts");
  if (doc.life && !doc.normalize) e("life", undefined, "needs normalize: true", "life programs are fitted to the normalized model (largest side 2)");
  return issues;
}
