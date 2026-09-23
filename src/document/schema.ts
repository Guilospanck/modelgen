import { z } from "zod";

export const PATTERNS = ["fur", "feathers", "scales", "spots", "stripes", "mottle", "flame", "runes"] as const;
export const SLOTS = ["head", "neck", "back", "claws", "teeth", "tail", "fins", "companion"] as const;
export const PLANS = ["quad", "winged_quad", "flyer", "perched", "cetacean", "fish", "seahorse", "seal", "turtle", "serpent", "kraken", "biped"] as const;
export const SHAPE_KEYS = ["group", "box", "sphere", "cylinder", "cone", "capsule", "torus", "plane", "extrude", "lathe", "tube", "blob", "script"] as const;

export type ShapeKey = (typeof SHAPE_KEYS)[number];
export type Slot = (typeof SLOTS)[number];
export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Radius2 = number | [number, number];
export type Texture = { pattern: (typeof PATTERNS)[number]; color?: string; belly?: string; scale?: number; seed?: number; bump?: number };
export type Material = { color: string; roughness?: number; metalness?: number; opacity?: number; emissive?: string; texture?: Texture };
export type BlobShape =
  | { sphere: { center: Vec3; radius: number } }
  | { ellipsoid: { center: Vec3; radii: Vec3 } }
  | { capsule: { from: Vec3; to: Vec3; radius: number; radiusEnd?: number } }
  | { chain: { points: Vec3[]; radii: number[] } };
export type Part = {
  name: string;
  position?: Vec3; rotation?: Vec3; scale?: number | Vec3;
  material?: string; visible?: boolean; surface?: boolean; bump?: number;
  group?: { parts: Part[] };
  box?: { size: Vec3 };
  sphere?: { radius: number; segments?: number };
  cylinder?: { radius: Radius2; height: number; segments?: number };
  cone?: { radius: number; height: number; segments?: number };
  capsule?: { radius: number; length: number; segments?: number };
  torus?: { radius: number; tube: number; segments?: number };
  plane?: { size: Vec2 };
  extrude?: { profile: Vec2[]; depth: number };
  lathe?: { profile: Vec2[]; segments?: number };
  tube?: { path: Vec3[]; radius?: number; radii?: Radius2[]; segments?: number; boxiness?: number };
  blob?: { shapes: BlobShape[]; blend?: number; resolution?: number };
  script?: { module: string; params?: Record<string, unknown> };
};
export type ModelDoc = {
  modelgen: 1;
  name: string;
  units?: "m";
  normalize?: boolean;
  materials?: Record<string, Material>;
  parts: Part[];
  anchors?: { slots: Slot[]; overrides?: Partial<Record<Slot, { pos: Vec3; scale: number }>> };
  life?: { plan: (typeof PLANS)[number]; params?: LifeParams; override?: LifeOverride };
};
// Life values are spliced into generated Metal source, so only numbers and booleans are allowed,
// plus `signature`, a lowercase word the clips only switch on.
export type LifeParams = { signature?: string; [key: string]: number | boolean | string | undefined };
export type LifeOverride = { head?: { c: Vec3; r: Vec3 }; neck?: Vec3; tailRoot?: Vec3; legTop?: number };

const pos = z.number().positive();
const vec2 = z.tuple([z.number(), z.number()]);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, { message: "expected a color like #ff8800" });
const segments = z.number().int().min(3).max(256);
const radius2 = z.union([pos, z.tuple([pos, pos])]);
const params = z.record(z.string(), z.unknown());

const TextureSchema = z.object({
  pattern: z.enum(PATTERNS), color: hex.optional(), belly: hex.optional(),
  scale: pos.optional(), seed: z.number().int().optional(), bump: z.number().min(0).optional(),
}).strict();

const MaterialSchema = z.object({
  color: hex,
  roughness: z.number().min(0).max(1).optional(),
  metalness: z.number().min(0).max(1).optional(),
  opacity: z.number().gt(0).max(1).optional(),
  emissive: hex.optional(),
  texture: TextureSchema.optional(),
}).strict();

const BlobShapeSchema = z.union([
  z.object({ sphere: z.object({ center: vec3, radius: pos }).strict() }).strict(),
  z.object({ ellipsoid: z.object({ center: vec3, radii: z.tuple([pos, pos, pos]) }).strict() }).strict(),
  z.object({ capsule: z.object({ from: vec3, to: vec3, radius: pos, radiusEnd: pos.optional() }).strict() }).strict(),
  z.object({ chain: z.object({ points: z.array(vec3).min(2), radii: z.array(pos).min(2) }).strict() }).strict(),
]);

export const PartSchema = z.lazy(() => z.object({
  name: z.string().min(1).max(100),
  position: vec3.optional(),
  rotation: vec3.optional(),
  scale: z.union([z.number().refine(v => v !== 0, { message: "scale can't be 0" }), vec3]).optional(),
  material: z.string().optional(),
  visible: z.boolean().optional(),
  surface: z.boolean().optional(),
  bump: z.number().min(0).optional(),
  group: z.object({ parts: z.array(PartSchema) }).strict().optional(),
  box: z.object({ size: z.tuple([pos, pos, pos]) }).strict().optional(),
  sphere: z.object({ radius: pos, segments: segments.optional() }).strict().optional(),
  cylinder: z.object({ radius: radius2, height: pos, segments: segments.optional() }).strict().optional(),
  cone: z.object({ radius: pos, height: pos, segments: segments.optional() }).strict().optional(),
  capsule: z.object({ radius: pos, length: z.number().min(0), segments: segments.optional() }).strict().optional(),
  torus: z.object({ radius: pos, tube: pos, segments: segments.optional() }).strict().optional(),
  plane: z.object({ size: z.tuple([pos, pos]) }).strict().optional(),
  extrude: z.object({ profile: z.array(vec2).min(3), depth: pos }).strict().optional(),
  lathe: z.object({ profile: z.array(vec2).min(2), segments: segments.optional() }).strict().optional(),
  tube: z.object({
    path: z.array(vec3).min(2), radius: pos.optional(), radii: z.array(radius2).optional(),
    segments: segments.optional(), boxiness: z.number().min(2).max(8).optional(),
  }).strict().optional(),
  blob: z.object({ shapes: z.array(BlobShapeSchema).min(1), blend: pos.optional(), resolution: z.number().int().min(16).max(160).optional() }).strict().optional(),
  script: z.object({ module: z.string().min(1), params: params.optional() }).strict().optional(),
}).strict()) as unknown as z.ZodType<Part>;

const LifeParamsSchema = z.object({ signature: z.string().regex(/^[a-z_]+$/, { message: "expected a lowercase word like bow" }).optional() })
  .catchall(z.union([z.number().finite(), z.boolean()]));
const LifeOverrideSchema = z.object({
  head: z.object({ c: vec3, r: z.tuple([pos, pos, pos]) }).strict(),
  neck: vec3,
  tailRoot: vec3,
  legTop: z.number().min(0).max(1),
}).partial().strict();

const AnchorSchema = z.object({ pos: vec3, scale: pos }).strict();

export const DocSchema = z.object({
  modelgen: z.literal(1),
  name: z.string().regex(/^[a-z0-9][a-z0-9_-]*$/, { message: "use lowercase letters, digits, _ and - (starting with a letter or digit)" }),
  units: z.literal("m").optional(),
  normalize: z.boolean().optional(),
  materials: z.record(z.string(), MaterialSchema).optional(),
  parts: z.array(PartSchema),
  anchors: z.object({ slots: z.array(z.enum(SLOTS)).min(1), overrides: z.partialRecord(z.enum(SLOTS), AnchorSchema).optional() }).strict().optional(),
  life: z.object({ plan: z.enum(PLANS), params: LifeParamsSchema.optional(), override: LifeOverrideSchema.optional() }).strict().optional(),
}).strict() as unknown as z.ZodType<ModelDoc>;
