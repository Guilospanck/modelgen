import { modelJsonSchema } from "../document";
import { opError } from "./load";
import { TEXT, TOPICS } from "./topics";

export { TOPICS };

export function describe(input: { topic?: string } = {}) {
  const topic = input.topic ?? "overview";
  if (!TEXT[topic]) throw opError("unknown_topic", `unknown topic "${topic}"`, `topics: ${TOPICS.join(", ")}`);
  return { topic, text: TEXT[topic], ...(topic === "schema" ? { schema: modelJsonSchema() } : {}) };
}
