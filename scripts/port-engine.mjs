// One-off: port the JS engine into src/engine as TypeScript (behaviour unchanged).
import fs from "node:fs";
import path from "node:path";

const HEADER = "// @ts-nocheck — ported engine; behaviour frozen by test/engine.golden.test.ts\n";
const files = {
  "lib.js": ["lib.ts", [
    ['"use strict";\nconst zlib = require("zlib");', 'import * as zlib from "node:zlib";'],
    ["module.exports = {", "export {"],
  ]],
  "sdf.js": ["sdf.ts", [
    ['"use strict";\n', ""],
    ["module.exports = { roundCone", "export { roundCone"],
  ]],
  "anatomy.js": ["anatomy.ts", [
    ['"use strict";\nconst lib = require("./lib");\nconst sdf = require("./sdf");', 'import * as lib from "./lib";\nimport * as sdf from "./sdf";'],
    ["module.exports = {", "export {"],
  ]],
  "overlay_lib.js": ["overlay.ts", [
    ['"use strict";\n', ""],
    ['const { rng } = require("./lib");', 'import { rng } from "./lib";'],
    ["module.exports = { add", "export { add"],
  ]],
  "render.js": ["render.ts", [
    ['"use strict";\nconst lib = require("./lib");', 'import * as lib from "./lib";\nimport { run } from "./life/dsl";'],
    ['  const { run } = require("./life/dsl");\n', ""],
    ["module.exports = { renderView", "export { renderView"],
  ]],
  "anchors.js": ["anchors.ts", [
    ['"use strict";\nconst { assembleTransform } = require("./lib");', 'import { assembleTransform } from "./lib";'],
    ['module.exports = { anchorsFor, toModelSpace, SLOTS: ["head", "neck", "back", "claws", "teeth", "tail", "fins", "companion"] };',
     'export const SLOTS = ["head", "neck", "back", "claws", "teeth", "tail", "fins", "companion"];\nexport { anchorsFor, toModelSpace };'],
  ]],
  "life/dsl.js": ["life/dsl.ts", [
    ['"use strict";\n', ""],
    ["module.exports = { run", "export { run"],
  ]],
  "life/clips.js": ["life/clips.ts", [
    ['"use strict";\n', ""],
    ["module.exports = { program };", "export { program };"],
  ]],
  "life/rigs.js": ["life/rigs.ts", [
    ['"use strict";\n', ""],
    ['const lib = require("../lib");', 'import * as lib from "../lib";'],
    ["module.exports = { rig };", "export { rig };"],
  ]],
};

for (const [from, [to, reps]] of Object.entries(files)) {
  let s = fs.readFileSync(from, "utf8");
  for (const [a, b] of reps) {
    if (!s.includes(a)) throw new Error(`${from}: expected text not found: ${a.slice(0, 60)}`);
    s = s.replace(a, b);
  }
  if (/require\(|module\.exports/.test(s)) throw new Error(`${from}: CommonJS left over`);
  const out = path.join("src/engine", to);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, HEADER + s);
  console.log(from, "->", out);
}
