# modelgen

Procedural 3D models from code. You write a small builder (JavaScript that
places tubes, slabs, spheres and signed-distance-field (SDF) sculpted masses,
and describes painted skins); modelgen assembles, validates and exports it.

- **Exports**: USDZ (Apple: SceneKit, RealityKit, AR Quick Look) and
  glTF 2.0 binary / GLB (three.js, Babylon.js, `<model-viewer>`, Godot,
  Unity, Android).
- **Textures**: procedural diffuse + normal maps (fur, feathers, scales,
  spots, stripes, mottle, flame, runes).
- **Anchors**: where attachments (hats, saddles, ribbons, companions) sit on
  a model, computed from its geometry.
- **Life**: idle-animation programs for unrigged meshes, written once, run in
  JavaScript (for previews) and emitted as Metal for SceneKit shader modifiers.
- **Everything through one CLI**; outputs are plain files any app bundles.
- **Previews**: a software renderer, so builders can be judged as PNGs
  without a 3D app.
- Plain Node (>= 18), no dependencies.

It is a command-line tool: builders in, files out. Apps never run it; they
bundle what it writes (on iOS, web, Android, desktop alike).

```sh
npm i -D @guilospanck/modelgen
npx modelgen build models/ --out assets/ --format usdz,glb
```

The npm package also exposes the toolkit your builders `require`
(`@guilospanck/modelgen/lib`, `/anatomy`, `/sdf`, ...) and the same steps as
a library, for pipelines the CLI does not cover.

## Writing a builder

A builder is a module exporting a function that returns `{ parts, textures }`.
Conventions: forward = +z, up = +y, ground at y = 0, symmetric in x.

```js
const { tube, uvSphere, place, part } = require("@guilospanck/modelgen/lib");

module.exports = () => ({
  parts: [
    part(place(uvSphere(20, 14), { s: [0.5, 0.6, 0.5], t: [0, 0.75, 0] }), "#e8a13a", { tex: "paper", emissive: "#6a3a08" }),
    part(tube([[0, 1.3, 0], [0, 1.42, 0]], [0.14, 0.14], 16), "#3a2a1c", { rough: 0.5 }),
  ],
  textures: { paper: { base: "#e8a13a", pattern: "stripes", patternColor: "#c4761f", freq: 6, seed: 3 } },
});
```

`part(mesh, color, opts)` options: `tex` (texture id), `rough` (0.7),
`metal` (0), `opacity` (1), `emissive` (hex), `bump` (noise displacement),
`surf` (surface detail such as fur tufts: exempt from the connectivity check).

Texture spec: `base`, `belly`, `pattern` (`fur` `feathers` `scales` `spots`
`stripes` `mottle` `flame` `runes`), `patternColor`, `freq`, `seed`,
`bumpStrength`.

Modules:

- `lib`: vector math, mesh primitives (`uvSphere`, `tube`, `slab`,
  `wingOutline`), transforms (`place`, `placeM`, `mirrorX`), `assemble`,
  `paintSkin`, USDA/USDZ and PNG writers
- `sdf`: smooth-blended SDF sculpting (`roundCone`, `sphere`, `ellipsoid`,
  `chain`, `meshField`)
- `anatomy`: creature kit on top of both (quadruped/bird/cetacean cores, wings,
  bat wings, crests, claws, ears, eyes, fur `coat`)
- `overlay_lib`: surface sampling for growing detail on an existing model
- `gltf`: GLB writer · `render`: software renderer (`preview`, `renderView`)
- `build`: `loadBuilders`, `buildModel`, `buildAll`, validators
- `anchors`: `anchorsFor(parts, slots, overrides)`, `toModelSpace`
- `life/dsl`, `life/clips`, `life/rigs`: animation programs (below)

See `examples/lantern.js` for a complete builder.

## Command line

```sh
modelgen build   <builders-dir> [names...] --out <dir> [--format usdz,glb] [--prefix <p>] [--keep-origin]
modelgen render  <builders-dir> [names...] --out <dir> [--views yaw:pitch,...] [--prefix <p>]
modelgen anchors <builders-dir> --config <file> --out <anchors.json>
modelgen life    <builders-dir> [names...] --config <file> --anchors <anchors.json> --out <life.json> [--previews <dir>]
```

All take `--exclude a.js,b.js` for helper modules in the builders dir that are
not builders. Configs are `.json` or `.js` (a `.js` config can compute its
table). `examples/` has one of each; `npm run example` runs them all.

- **build**: every model is validated before it is written: part colors and
  texture references, connectivity (no floating parts), and the file
  structure (USDZ: stored zip, 64-byte aligned entries; GLB: header and
  chunks). `--keep-origin` is for attachments: normally a model is recentred
  and scaled so its largest side is 2; an attachment keeps its authored
  origin (its mount point) and size instead.
- **render**: PNG contact sheets from the software renderer.
- **anchors**: config `{ "<model>": { "slots": [...], "overrides": { "<slot>": { "pos": [x,y,z], "scale": s } } } }`.
- **life**: config `{ "<model>": { "plan": "quad", ...params, "override": {...} } }`
  (see Life below); `--previews` renders frames across the cycle.

## Output files

| file | shape | use |
|------|-------|-----|
| `<name>.usdz` | USD zip: `model.usda` + `textures/*.png` | SceneKit, RealityKit, AR Quick Look |
| `<name>.glb` | glTF 2.0 binary, PBR materials, embedded PNGs | three.js, Babylon.js, `<model-viewer>`, Godot, Unity, Android |
| `anchors.json` | `{ model: { slot: { pos: [x,y,z], scale } } }` | place an attachment (built with `--keep-origin`) as a child of the model at `pos`, uniformly scaled by `scale`, before any framing |
| `life.json` | `{ model: { plan, metal } }` | `metal` is the body of a SceneKit `.geometry` shader modifier: declare `float t = u_time; float3 p = _geometry.position.xyz; float3 n = _geometry.normal.xyz;`, paste it, then write `p` and `normalize(n)` back |

Models come out centred with their largest side 2 units, +y up, +z forward.

## Anchors

Where attachments sit, from the geometry. Through the CLI (`modelgen
anchors`) or the library:

```js
const { anchorsFor, toModelSpace } = require("@guilospanck/modelgen/anchors");
const { parts } = build();
const anchors = toModelSpace(anchorsFor(parts, ["head", "back", "tail"]), parts);
// { head: { pos: [x, y, z], scale }, ... } in the exported model's space
```

Slots: `head`, `neck`, `back`, `claws`, `teeth`, `tail`, `fins`, `companion`.
Pass per-slot `overrides` for the models the heuristics get wrong.

## Life (idle animation)

A 16-second behaviour cycle per body plan (idle, walk, signature move...),
fitted to each model's rig (hips, wing roots, head, jaw, tail — derived from
the mesh and its anchors). Through the CLI (`modelgen life`) or the library:

```js
const { rig } = require("@guilospanck/modelgen/life/rigs");
const { program } = require("@guilospanck/modelgen/life/clips");
const { emit, lint, run } = require("@guilospanck/modelgen/life/dsl");

const R = rig({ name, spec: { plan: "quad", stride: 0.45, gait: 8.5 }, parts, anchors: modelSpaceAnchors });
const prog = program(R);
const metal = emit(prog);      // SceneKit geometry shader modifier body
lint(metal);                   // [] when it will compile
run(prog, position, normal, t) // same motion in JS, for previews
```

Body plans: `quad`, `winged_quad`, `flyer`, `perched`, `cetacean`, `fish`,
`seahorse`, `seal`, `turtle`, `serpent`, `kraken`, `biped`. Metal is the only
shader target today; a GLSL emitter would bring the same motion to the web.

## Development

```sh
npm test              # tests
npm run example       # every command on examples/, into out/
```

Consumers developing against a local checkout: `npm link` in their project.

## Releasing

1. Bump `version` in `package.json`, commit.
2. `git tag v0.2.0 && git push origin main v0.2.0`
3. The `release` workflow runs the tests, publishes `@guilospanck/modelgen`
   to npm (once the `NPM_TOKEN` repository secret exists; skipped before) and
   creates a GitHub release. Consumers can also install straight from a tag:
   `npm i -D github:Guilospanck/modelgen#v0.2.0`.

## License

MIT
