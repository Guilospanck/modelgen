import { modelJsonSchema, PATTERNS, PLANS, SLOTS, SHAPE_KEYS } from "../document";
import { VIEW_PRESETS } from "./capture";
import { MAX_OPS } from "./edit";
import { opError } from "./load";

const TEXT: Record<string, string> = {
  overview: `modelgen builds 3D models from a YAML document and exports GLB and USDZ.
Loop: create_model → edit_model (batches of ops) → capture (look at the PNG, read issues) → fix → export.
Topics: ${["shapes", "materials", "patterns", "ops", "conventions", "project", "scripts", "schema"].join(", ")}.`,
  conventions: `Units are meters. +y is up, +z is the model's front, x is left/right.
Rotations are radians, XYZ order (applied x, then y, then z). Colors are #rrggbb.
A group's origin is the pivot of its children. Part names are unique within a model.
normalize: true recentres the exported model and scales its largest side to 2 (needed for life).
Capture views are [yaw, pitch] in degrees; yaw 0 looks at the front. Presets: ${Object.keys(VIEW_PRESETS).join(", ")}.`,
  shapes: `Every part has name, one shape, and optional position [x,y,z], rotation [x,y,z], scale (number or [x,y,z]), material, visible, surface, bump.
Shapes (${SHAPE_KEYS.join(", ")}):
  group: { parts: [...] } — children in the group's frame
  box: { size: [x, y, z] }
  sphere: { radius, segments? }
  cylinder: { radius (or [top, bottom]), height, segments? } — along y, centred
  cone: { radius, height, segments? } — apex at +y
  capsule: { radius, length, segments? } — along y, total height length + 2·radius
  torus: { radius, tube, segments? } — ring in the xz plane
  plane: { size: [x, z] } — flat, facing +y
  extrude: { profile: [[x, y], ...], depth } — profile in xy, extruded along z, centred; convex or star-shaped profiles
  lathe: { profile: [[radius, y], ...], segments? } — revolved around y (vases, bottles, lamp bodies)
  tube: { path: [[x, y, z], ...], radius | radii: [r or [a, b] per point], segments?, boxiness? (2 round … 8 boxy) }
  blob: { shapes: [{ sphere: { center, radius } } | { ellipsoid: { center, radii } } | { capsule: { from, to, radius, radiusEnd? } } | { chain: { points, radii } }], blend?, resolution? } — one smooth surface blended from the shapes (organic forms)
  text: { string, size, depth, align? (left | center | right), spacing?, lineHeight?, segments? } — extruded letters in xy, centred on z; size is the capital-letter height; "\\n" starts a new line. Built-in font: IBM Plex Sans SemiBold (Latin-1 plus – — ‘ ’ “ ” • … € ™ ↑ ↓)
  script: { module, params? } — see topic scripts
surface: true exempts detail (fur, scales) from the floating check; bump adds noise displacement.`,
  materials: `materials: { <name>: { color, roughness? (0.7), metalness? (0), opacity? (1), emissive?, texture? } }
texture: { pattern, color?, belly?, scale?, seed?, bump? } — procedural diffuse + normal map.
Patterns: ${PATTERNS.join(", ")} (topic patterns). Parts refer to materials by name.`,
  patterns: `texture: { pattern, color?, belly?, scale?, seed?, bump? } on a material paints a procedural diffuse + normal map.
  pattern — one of ${PATTERNS.join(", ")}
  color   — the pattern's colour (default: a darker shade of the material color)
  belly   — an underside colour blended into one end of the texture
  scale   — pattern frequency (bigger = finer detail)
  seed    — integer; changes the random layout
  bump    — normal-map strength (0 = flat)
Patterns:
  fur       layered pelt: directional strands and fine grain
  feathers  shingled rows of feathers with barb streaks
  scales    domed scales with dark rims and weathering
  spots     stamped ellipses in the pattern colour
  stripes   bands in the pattern colour
  mottle    big soft two-tone patches (seals, stone, weathered hide)
  flame     living fire: gold → orange → crimson tongues
  runes     sparse glyph strokes over a soft mottled base`,
  ops: `edit_model takes up to ${MAX_OPS} ops, applied in order as one step (all or nothing). Later ops can refer to parts added earlier in the batch.
  { add: { parent?, part } }
  { update: { name, set: { position?, rotation?, scale?, material?, <shape>: {...fields to change}, <key>: null to unset } } }
  { remove: { name } }
  { rename: { name, to } }
  { reparent: { name, parent (group name or null for top level) } }
  { duplicate: { name, as, set? } } — children become "<as>.<child>"
  { set_material: { name, material } }
  { remove_material: { name } }
  { set: { normalize?, anchors?, life? } } — null removes
anchors: { slots: [${SLOTS.join(", ")}], overrides?: { <slot>: { pos, scale } } }
life: { plan: ${PLANS.join(" | ")}, params?, override? } (needs normalize: true)
undo / redo step through edits. Comments in hand-written YAML are not kept by edits.`,
  project: `modelgen.yaml (optional, created by modelgen init):
  models: models          # where <name>.model.yaml live
  previews: previews      # capture output
  outputs:                # used by build
    - dir: build/web
      formats: [glb]      # glb, usdz
      prefix: ""          # file name prefix
      models: ["*"]       # name globs; "!pattern" excludes
      anchors: anchors.json   # optional aggregate of models' anchors
      life: life.json         # optional aggregate of life programs`,
  scripts: `A script part runs a JavaScript builder: { name, script: { module: "./path.js", params: {...} } }.
The module exports build(params, kit) returning { parts, textures }, where parts are engine parts
(kit.lib.part(mesh, color, opts)) and kit = { lib, sdf, anatomy, overlay }. Paths are relative to the model file.
Scripts are trusted local code. Over MCP they can only be added or changed when modelgen runs with --allow-scripts.`,
  schema: "The JSON Schema of a model document is in `schema`.",
};

export const TOPICS = Object.keys(TEXT);

export function describe(input: { topic?: string } = {}) {
  const topic = input.topic ?? "overview";
  if (!TEXT[topic]) throw opError("unknown_topic", `unknown topic "${topic}"`, `topics: ${TOPICS.join(", ")}`);
  return { topic, text: TEXT[topic], ...(topic === "schema" ? { schema: modelJsonSchema() } : {}) };
}
