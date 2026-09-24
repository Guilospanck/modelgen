# modelgen

Generate 3D models by describing them. Tell your AI agent "make me a witch's
lantern" and it builds one with modelgen's tools, looks at renders, fixes
what's wrong and exports files your app can load: **GLB** (web, Android,
game engines, desktop) and **USDZ** (iOS, macOS, AR Quick Look).

Models are plain YAML files you can read, version and edit by hand.

## Install

```sh
brew install guilospanck/tap/modelgen                                              # macOS, Linux
curl -fsSL https://raw.githubusercontent.com/Guilospanck/modelgen/main/install.sh | sh   # any Unix
npm install -g @guilospanck/modelgen                                               # with Node 20+
```

With npm you can also add it to a project instead of installing it globally,
or run it without installing:

```sh
npm install --save-dev @guilospanck/modelgen   # then: npx modelgen build
npx -y @guilospanck/modelgen --help            # one-off, nothing installed
```

Windows: use npm (above), or download `modelgen-<version>-windows-x64.zip` from the
[releases](https://github.com/Guilospanck/modelgen/releases).

## Use it from your agent

modelgen is an MCP server. Run it from the folder where your models should live.

Claude Code:

```sh
claude mcp add modelgen -- modelgen mcp
```

Claude Desktop, Cursor and other MCP clients (`mcpServers` config):

```json
{ "mcpServers": { "modelgen": { "command": "modelgen", "args": ["mcp", "--project", "/path/to/project"] } } }
```

Without installing it, through npx:

```json
{ "mcpServers": { "modelgen": { "command": "npx", "args": ["-y", "@guilospanck/modelgen", "mcp", "--project", "/path/to/project"] } } }
```

Then ask for a model. The agent will create it, add parts, capture renders to
check its work and export it.

| tool | what it does |
|------|--------------|
| `describe` | explains shapes, materials, texture patterns, edit ops, conventions, project config |
| `create_model` | new empty model (or a copy of another) |
| `list_models` | models in the project |
| `inspect_model` | parts, materials, world-space bounds |
| `edit_model` | apply up to 100 changes at once; all or nothing, one undo step |
| `undo`, `redo` | step through edits |
| `capture` | PNG renders from several angles + where each part is + problems to fix |
| `export` | write GLB / USDZ files |
| `build` | export every output configured for the project |

## Use it yourself

```sh
modelgen init                     # modelgen.yaml + models/
modelgen new lantern
modelgen edit lantern ops.yaml    # or: --op '{"add": {"part": {...}}}'
modelgen capture lantern          # previews/lantern.png + problems
modelgen export lantern --out assets --format glb,usdz
modelgen build                    # every output in modelgen.yaml
modelgen describe shapes          # reference for shapes, materials, ops...
```

Every command takes `--project <dir>`. Most take `--json` for machine-readable
output (`schema` always prints JSON; `mcp` ignores it).
Exit codes: 0 ok, 1 the model has problems or the operation failed, 2 bad usage.

## Model files

```yaml
modelgen: 1
name: lantern
materials:
  paper: {color: "#e8a13a", roughness: 0.8, texture: {pattern: stripes, color: "#c4761f"}}
  iron: {color: "#2a2a2a", metalness: 0.8}
parts:
  - name: body
    lathe: {profile: [[0, 0], [0.2, 0.1], [0.25, 0.4], [0.15, 0.7], [0, 0.72]]}
    material: paper
  - name: handle
    tube: {path: [[-0.08, 0.74, 0], [0, 0.9, 0], [0.08, 0.74, 0]], radius: 0.012}
    material: iron
```

- Units are meters, +y is up, +z is the front, rotations are radians.
- Shapes: `box`, `sphere`, `cylinder`, `cone`, `capsule`, `torus`, `plane`,
  `extrude`, `lathe`, `tube`, `blob` (smooth organic forms) and `group`.
- Texture patterns: fur, feathers, scales, spots, stripes, mottle, flame, runes.
- Parts must touch: floating parts are reported and block export.
- `modelgen describe` has the full reference; `modelgen schema` prints the
  JSON Schema (for editor autocomplete).

See [`examples/`](examples) for a lantern, a crate, a mug and a scripted pebble.

## Projects

`modelgen.yaml` tells `build` where to write what:

```yaml
models: models
outputs:
  - dir: ../web/public/models
    formats: [glb]
  - dir: ../ios/App/Models
    formats: [usdz]
    models: ["*", "!draft_*"]
```

## Advanced: script parts

When a shape can't be described in YAML, a part can run a JavaScript builder:
`{ name: stone, script: { module: scripts/pebble.js, params: { seed: 4 } } }`.
Scripts are trusted local code. Agents can only add or change them when the
server runs with `modelgen mcp --allow-scripts`. See `modelgen describe scripts`.

## License

MIT
