// The playground's assistant: prompts that ask a language model for modelgen edit ops, reading its
// reply back, and a JSON Schema that local models are held to while they write. No model runs here;
// the page supplies one (the visitor's own chat via copy and paste, or one in the browser).
import type { Issue } from "./document/issues";
import type { ModelDoc, Part } from "./document/schema";
import { modelJsonSchema } from "./document/text";
import { TEXT } from "./ops/topics";

const REPLY = 'Reply with ONLY a JSON object {"ops": [...]}: no prose, no code fences.';

const RULES = `Rules that matter:
- Every part must touch another part (a floating part can't be exported). The floor is y = 0: stand objects on it.
- Part names are unique; new parts need new names. Keep existing parts unless the request says otherwise; change them with update.
- Colors come from materials: set_material first, then give parts material: <name>.
- Rotations are radians. Sizes are meters: a mug is about 0.1 tall, a chair about 0.9.`;

// Short enough for a local model with a 4096-token window, with room left for the answer.
const COMPACT = `You edit 3D models for modelgen. ${REPLY}
Ops apply in order, all or nothing:
{"add":{"part":{...},"parent":"<group>"?}} {"update":{"name":"<part>","set":{...}}} {"remove":{"name":"<part>"}}
{"rename":{"name":"<part>","to":"<new>"}} {"duplicate":{"name":"<part>","as":"<new>","set":{...}?}}
{"set_material":{"name":"<m>","material":{"color":"#rrggbb","roughness":0.5?,"metalness":0?,"emissive":"#rrggbb"?}}}
A part: {"name", one shape, "position":[x,y,z]?, "rotation":[x,y,z]?, "scale"?, "material"?}. +y is up, +z is the front.
Shapes (centred on the part's position unless noted):
box {"size":[x,y,z]} · sphere {"radius"} · cylinder {"radius","height"} along y · cone {"radius","height"} apex up ·
capsule {"radius","length"} along y · torus {"radius","tube"} ring in xz · plane {"size":[x,z]} facing up ·
extrude {"profile":[[x,y],...],"depth"} along z · lathe {"profile":[[r,y],...]} around y, from the part's origin ·
tube {"path":[[x,y,z],...],"radius"} · blob {"shapes":[{"sphere":{"center":[x,y,z],"radius"}},...]} one smooth surface ·
text {"string","size","depth"} letters in xy · group {"parts":[...]} children in the group's frame
${RULES}
Example: "add a red ball on top of the box" (box 0.2 tall standing on the floor) →
{"ops":[{"set_material":{"name":"red","material":{"color":"#cc2222"}}},{"add":{"part":{"name":"ball","sphere":{"radius":0.05},"position":[0,0.25,0],"material":"red"}}}]}`;

const FULL = `You edit 3D models for modelgen, a tool that builds 3D models from a YAML document. ${REPLY}
The ops are applied in order to the model shown below, all or nothing.

${TEXT.conventions}

${TEXT.shapes}

${TEXT.materials}

${TEXT.ops}

${RULES}`;

const problems = (issues: Issue[]) =>
  issues.map(i => `- ${i.part ? `${i.part}: ` : ""}${i.message.replace(/^model\.yaml:?\s*/, "")}${i.hint ? ` (${i.hint})` : ""}`).join("\n");

const modelBlock = (text: string) => `The model now:\n\`\`\`yaml\n${text.trimEnd()}\n\`\`\``;

export function promptFor(t: { request: string; text: string; issues?: Issue[]; compact?: boolean }): { system: string; user: string } {
  const now = t.issues?.length ? `\n\nProblems modelgen reports now:\n${problems(t.issues)}` : "";
  return { system: t.compact ? COMPACT : FULL, user: `${modelBlock(t.text)}${now}\n\nRequest: ${t.request.trim()}` };
}

// The next turn after a reply: its ops were rejected, or they applied but left problems.
export function followUpFor(t: { request: string; text: string; issues?: Issue[]; rejected?: string }): string {
  const what = t.rejected
    ? `Your ops were rejected, nothing changed: ${t.rejected}`
    : `Your ops were applied, but modelgen reports:\n${problems(t.issues ?? [])}`;
  return `${what}\n\n${modelBlock(t.text)}\n\nReply with ops that fix this, still aiming for: ${t.request.trim()}\n${REPLY}`;
}

// The first JSON value in a reply, fenced or not: {"ops": [...]} or a bare list of ops.
export function parseOpsReply(reply: string): { ops?: unknown[]; error?: string } {
  const body = reply.replace(/```(?:json)?/gi, "");
  const start = body.search(/[[{]/);
  if (start < 0) return { error: "The reply has no JSON in it. Ask for the ops as JSON only." };
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  let value: unknown;
  try { value = JSON.parse(body.slice(start, end + 1)); } catch (e) {
    return { error: `The reply's JSON doesn't parse: ${(e as Error).message}` };
  }
  const ops = Array.isArray(value) ? value : (value as { ops?: unknown })?.ops;
  if (!Array.isArray(ops)) return { error: 'Expected {"ops": [...]} or a list of ops.' };
  if (!ops.length) return { error: "The reply has no ops in it." };
  return { ops };
}

function names(parts: Part[], out: { all: string[]; groups: string[] } = { all: [], groups: [] }) {
  for (const p of parts) {
    out.all.push(p.name);
    if (p.group) { out.groups.push(p.name); names(p.group.parts, out); }
  }
  return out;
}

// What a local model may write: parts and materials follow the model schema, and the parts an
// op points at must exist (an enum of the model's own names), so it can't invent a target.
export function opsSchema(doc: ModelDoc): object {
  const model = modelJsonSchema() as { $defs: object; properties: { materials: { additionalProperties: object } } };
  const part = { $ref: "#/$defs/__schema0" };
  const material = model.properties.materials.additionalProperties;
  const { all, groups } = names(doc.parts);
  const op = (key: string, props: Record<string, object>, required: string[]) => ({
    type: "object", additionalProperties: false, required: [key],
    properties: { [key]: { type: "object", additionalProperties: false, required, properties: props } },
  });
  const existing = { type: "string", enum: all };
  const fresh = { type: "string", minLength: 1 };
  const variants = [
    op("add", { part, ...(groups.length ? { parent: { type: "string", enum: groups } } : {}) }, ["part"]),
    op("set_material", { name: fresh, material }, ["name", "material"]),
    ...(all.length ? [
      op("update", { name: existing, set: { type: "object" } }, ["name", "set"]),
      op("remove", { name: existing }, ["name"]),
      op("rename", { name: existing, to: fresh }, ["name", "to"]),
      op("duplicate", { name: existing, as: fresh, set: { type: "object" } }, ["name", "as"]),
    ] : []),
  ];
  return {
    type: "object", additionalProperties: false, required: ["ops"],
    properties: { ops: { type: "array", minItems: 1, maxItems: 30, items: { anyOf: variants } } },
    $defs: model.$defs,
  };
}
