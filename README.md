# modelgen

Generate 3D models by describing them. Tell your AI agent "make me a witch's
lantern" and it builds one with modelgen's tools, looks at renders, fixes
what's wrong and exports files your app can load: **GLB** (web, Android,
game engines, desktop) and **USDZ** (iOS, macOS, AR Quick Look).

Models are plain YAML files you can read, version and edit by hand.

**[Try it in your browser →](https://guilospanck.github.io/modelgen/)** Build a
model in a 3D editor or describe it to your own AI chat, see its YAML, and
download it. Nothing to install, no account, no API key.

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

### What to ask

Describe what you want; the agent does the rest.

Make a model:

- "Use modelgen to make a low-poly witch's lantern: lathed glass body, iron cap and handle. Capture it, fix any issues, and export GLB and USDZ to `assets/`."
- "Create a wooden treasure chest with metal bands and a lock. Use the mottle texture for the wood. Show me the capture."
- "Make a coffee mug with a handle, about 10 cm tall, and export it as GLB."
- "Build a simple stylized tree: a tapered trunk (tube) and a blob canopy. Keep everything connected."
- "Make a keyboard keycap, 18 mm square, with the word Esc on top in white."

Iterate on it:

- "Show me the lantern from the front and from the top."
- "The handle is too thin: make it twice as thick, then capture again."
- "Make the body taller and give the paper material an orange emissive glow."
- "Undo the last change."
- "Duplicate the left chair leg to make the other three, mirrored."
- "Inspect the chest and tell me which parts are floating."

Export and projects:

- "Set up a modelgen project here that exports GLB to `web/public/models` and USDZ to `ios/Models`, then build everything."
- "Export just the `handle` part of the lantern as its own GLB."
- "List my models and rebuild them."

Learn what's possible:

- "Ask modelgen which shapes and materials it supports."
- "What texture patterns does modelgen have?"

Tips:

- **Ask for captures.** The agent sees the render plus a list of problems ("handle is floating, nearest part is cap, 0.04 away"); "capture it and fix everything it reports" gets noticeably better results.
- **Give real sizes.** Units are meters: "a 30 cm lantern" beats "a small lantern".
- **Name the building blocks when you care:** `lathe` for round things (vases, bottles, lamp bodies), `extrude` for flat profiles, `tube` for handles, pipes and limbs, `blob` for organic forms, `text` for letters and labels, groups for parts that move together.
- **Models are files:** `models/<name>.model.yaml` in the project. You can read or hand-edit them; the agent picks up your edits, and its own edits keep your comments and formatting.
- **Current limits:** no boolean cut-outs or bevels yet (hollows are made with profiles), no ready-made kits (creature, furniture...), and script parts only when the server runs with `modelgen mcp --allow-scripts`.

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

## Try it in the browser

The [playground](https://guilospanck.github.io/modelgen/) runs modelgen in your
browser. Everything but script parts works there.

- **Build in 3D.** Add any shape, including `text`, and move, rotate and scale
  it with gizmos (W / E / R, optional snapping). Drag the points of profiles,
  paths and blobs. Regroup parts in the scene list, edit shapes and materials
  in the sidebar, or type the YAML directly. Undo and redo cover all of it.
- **Fix problems in place.** Problems show on the parts they belong to, and
  the common ones have a Fix button: a floating part moves to touch the model,
  and a missing material gets defined.
- **Ask in words.** The Ask tab writes a prompt for the change you describe.
  Paste it into ChatGPT, Claude, Gemini or any chat you use, then paste the
  reply back. The playground applies it as modelgen edits, and writes a
  follow-up for the same chat if anything is left to fix. The page itself talks
  to no AI and needs no API key.
- **Keep your models.** Start from an example or a new, empty model (it gets a
  random name until you give it one). Changes save automatically, in this
  browser only, and examples stay untouched: your first change saves a copy.
- **Take it with you.** Download GLB and USDZ, or copy a link that carries the
  model.

Every change is a modelgen edit, so the YAML keeps its comments and the result
is a normal model file you can use with the CLI.

It deploys from `main` (`site/` + `bun run build:web`, which writes `web-dist/`).

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
  `extrude`, `lathe`, `tube`, `blob` (smooth organic forms), `text` (extruded
  letters, e.g. `text: {string: Esc, size: 0.004, depth: 0.0004}`) and `group`.
- Texture patterns: fur, feathers, scales, spots, stripes, mottle, flame, runes.
- Parts must touch: floating parts are reported and block export.
- `modelgen describe` has the full reference; `modelgen schema` prints the
  JSON Schema (for editor autocomplete).

See [`examples/`](examples) for a lantern, a crate, a mug, a keycap with a text legend and a scripted pebble.

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

MIT. The `text` shape's built-in font is IBM Plex Sans (SIL Open Font License
1.1, see [`LICENSE-fonts.txt`](LICENSE-fonts.txt)).
