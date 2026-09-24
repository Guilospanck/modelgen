// The playground's assistant: the prompt that asks a language model for modelgen edit ops, and
// reading its reply back. No model runs here: the visitor carries the text to their own AI chat.
import type { Issue } from "./document/issues";
import { TEXT } from "./ops/topics";

const REPLY = 'Reply with ONLY a JSON object {"ops": [...]}: no prose, no code fences.';

const RULES = `Rules that matter:
- Every part must touch another part (a floating part can't be exported). The floor is y = 0: stand objects on it.
- Part names are unique; new parts need new names. Keep existing parts unless the request says otherwise; change them with update.
- Colors come from materials: set_material first, then give parts material: <name>.
- Rotations are radians. Sizes are meters: a mug is about 0.1 tall, a chair about 0.9.`;

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

export function promptFor(t: { request: string; text: string; issues?: Issue[] }): { system: string; user: string } {
  const now = t.issues?.length ? `\n\nProblems modelgen reports now:\n${problems(t.issues)}` : "";
  return { system: FULL, user: `${modelBlock(t.text)}${now}\n\nRequest: ${t.request.trim()}` };
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
