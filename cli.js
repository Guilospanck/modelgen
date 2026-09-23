#!/usr/bin/env node
// modelgen CLI: builders in, files out.
//
//   modelgen build   <builders-dir> [names...] --out <dir> [--format usdz,glb]
//                    [--prefix <p>] [--keep-origin]
//   modelgen render  <builders-dir> [names...] --out <dir> [--views yaw:pitch,...]
//                    [--prefix <p>]
//   modelgen anchors <builders-dir> --config <anchors-config> --out <anchors.json>
//   modelgen life    <builders-dir> [names...] --config <life-config>
//                    --anchors <anchors.json> --out <life.json> [--previews <dir>]
//
// Every command takes --exclude a.js,b.js for helper modules in the
// builders dir that are not builders themselves. Configs are .json or .js
// modules (a .js config can compute its table). See README.
"use strict";
const fs = require("fs");
const path = require("path");
const { loadBuilders, buildAll } = require("./build");
const { preview, lifePreview } = require("./render");
const { anchorsFor, toModelSpace } = require("./anchors");
const { rig } = require("./life/rigs");
const { program } = require("./life/clips");
const { emit, lint } = require("./life/dsl");

const USAGE = `usage:
  modelgen build   <builders-dir> [names...] --out <dir> [--format usdz,glb] [--prefix <p>] [--keep-origin]
  modelgen render  <builders-dir> [names...] --out <dir> [--views yaw:pitch,...] [--prefix <p>]
  modelgen anchors <builders-dir> --config <file> --out <anchors.json>
  modelgen life    <builders-dir> [names...] --config <file> --anchors <anchors.json> --out <life.json> [--previews <dir>]
options for all: --exclude a.js,b.js (helper modules that are not builders)`;

const VALUE_FLAGS = ["out", "format", "prefix", "exclude", "views", "config", "anchors", "previews"];

function parse(argv) {
  const o = { names: [], format: "usdz", prefix: "", exclude: "", keepOrigin: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const [flag, inline] = a.startsWith("--") ? [a.slice(2).split("=")[0], a.includes("=") ? a.slice(a.indexOf("=") + 1) : undefined] : [];
    if (flag && VALUE_FLAGS.includes(flag)) o[flag] = inline ?? argv[++i];
    else if (a === "--keep-origin") o.keepOrigin = true;
    else if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
    else if (flag) throw new Error(`unknown flag ${a}\n${USAGE}`);
    else if (!o.cmd) o.cmd = a;
    else if (!o.dir) o.dir = a;
    else o.names.push(a);
  }
  if (!o.cmd || !o.dir || !o.out) throw new Error(USAGE);
  return o;
}

const loadConfig = file => require(path.resolve(file));
const selected = (o, name) => !o.names.length || o.names.includes(name);

const commands = {
  build(o, builders) {
    return buildAll(builders, { outDir: o.out, formats: o.format.split(","), prefix: o.prefix, only: o.names, keepOrigin: o.keepOrigin });
  },

  render(o, builders) {
    const views = o.views && o.views.split(",").map(v => v.split(":").map(Number));
    fs.mkdirSync(o.out, { recursive: true });
    for (const [name, build] of Object.entries(builders)) {
      if (!selected(o, name)) continue;
      fs.writeFileSync(path.join(o.out, o.prefix + name + ".png"), preview(build(), views ? { views } : {}));
      console.log("rendered", name);
    }
    return 0;
  },

  // config: { <model>: { slots: [...], overrides?: { <slot>: { pos, scale } } } }
  anchors(o, builders) {
    if (!o.config) throw new Error("anchors needs --config");
    const config = loadConfig(o.config);
    const all = {};
    for (const [name, build] of Object.entries(builders)) {
      const c = config[name];
      if (!c) continue;
      const { parts } = build();
      all[name] = toModelSpace(anchorsFor(parts, c.slots, c.overrides), parts);
      console.log(name.padEnd(20), Object.keys(all[name]).join(","));
    }
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, JSON.stringify(all, null, 1));
    console.log(`${path.basename(o.out)}: ${Object.keys(all).length} models`);
    return 0;
  },

  // config: { <model>: { plan, ...params, override?: { head, neck, legTop, tailRoot } } }
  // With names, only those are rebuilt and merged into an existing --out.
  life(o, builders) {
    if (!o.config || !o.anchors) throw new Error("life needs --config and --anchors");
    const config = loadConfig(o.config);
    const anchors = JSON.parse(fs.readFileSync(o.anchors, "utf8"));
    const life = o.names.length && fs.existsSync(o.out) ? JSON.parse(fs.readFileSync(o.out, "utf8")) : {};
    if (o.previews) fs.mkdirSync(o.previews, { recursive: true });
    let fail = 0;
    for (const [name, build] of Object.entries(builders)) {
      if (!config[name] || !selected(o, name)) continue;
      const { override = {}, ...spec } = config[name];
      const model = build();
      const prog = program(rig({ name, spec, parts: model.parts, anchors: anchors[name] || {}, override }));
      const metal = emit(prog);
      const problems = lint(metal);
      if (problems.length) { console.error(`${name}: ${problems.join("; ")}`); fail++; }
      life[name] = { plan: spec.plan, metal };
      if (o.previews) fs.writeFileSync(path.join(o.previews, `life_${name}.png`), lifePreview(model, prog));
      console.log(o.previews ? "rendered" : "emitted", name, spec.plan);
    }
    fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
    fs.writeFileSync(o.out, JSON.stringify(life));
    console.log(`${path.basename(o.out)}: ${Object.keys(life).length} models, ${Math.round(fs.statSync(o.out).size / 1024)} KB`);
    return fail;
  },
};

function main() {
  const o = parse(process.argv.slice(2));
  const command = commands[o.cmd];
  if (!command) throw new Error(USAGE);
  const builders = loadBuilders(o.dir, { exclude: o.exclude ? o.exclude.split(",") : [] });
  process.exit(command(o, builders) ? 1 : 0);
}

try { main(); } catch (e) { console.error(e.message); process.exit(2); }
