import type { ModelDoc } from "../document";
import { compileTree, type Compiled } from "./tree";
import { runScript } from "./script";

export * from "./tree";

// Node entry point: script parts load relative to baseDir.
export function compileModel(doc: ModelDoc, opts: { baseDir: string }): Compiled {
  return compileTree(doc, p => runScript(p, opts.baseDir));
}
