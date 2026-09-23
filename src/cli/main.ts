import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import * as YAML from "yaml";
import { OpError, modelJsonSchema, type Issue } from "../document";
import * as ops from "../ops";
import { startMcpServer } from "../mcp/server";
import { VERSION } from "../version";
import { parseArgs, UsageError } from "./args";
import { formatIssues, human } from "./format";

export type IO = { out: (s: string) => void; err: (s: string) => void; stdin: () => string; cwd: string };

const defaultIO: IO = {
  out: s => process.stdout.write(s),
  err: s => process.stderr.write(s),
  stdin: () => readFileSync(0, "utf8"),
  cwd: process.cwd(),
};

export const HELP = `modelgen ${VERSION} — generate 3D models (GLB, USDZ) from YAML model files

Usage: modelgen <command> [options]

Commands:
  init                              create modelgen.yaml and models/
  new <name> [--from <model>]       create a model
  list                              list models
  inspect <model> [--part <p>]      parts, materials, bounds
  edit <model> [<ops-file> | -]     apply a batch of ops (YAML/JSON list) from a file or stdin,
                                    or pass --op '<json>' (repeatable)
  undo <model>, redo <model>        step through edit history
  capture <model> [--part <p>] [--views <preset>|<yaw:pitch,...>] [--size <px>]
                                    render PNG views and report problems
  export <model> --out <dir> [--format glb,usdz] [--part <p>]
  build [<model>...]                export every output listed in modelgen.yaml
  describe [<topic>]                how shapes, materials, ops and projects work
  schema                            print the model JSON Schema
  mcp [--allow-scripts]             run the MCP server on stdio (for AI agents)

Options:
  --project <dir>   project directory (default: current directory)
  --json            print results as JSON
  --allow-scripts   allow adding/changing script parts
  -h, --help        show this help
  -v, --version     show the version
`;

const need = (positional: string[], i: number, what: string) => {
  if (positional[i] === undefined) throw new UsageError(`missing ${what}`);
  return positional[i];
};

function parseViews(v: string | undefined): string | [number, number][] | undefined {
  if (v === undefined || !v.includes(":")) return v;
  return v.split(",").map(pair => {
    const [y, p] = pair.split(":").map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(p)) throw new UsageError(`bad view "${pair}" (expected yaw:pitch)`);
    return [y, p] as [number, number];
  });
}

function readOps(file: string | undefined, inline: string[], io: IO): unknown[] {
  const list: unknown[] = inline.map(s => { try { return JSON.parse(s); } catch { throw new UsageError(`--op is not valid JSON: ${s}`); } });
  if (file !== undefined) {
    const where = file === "-" ? "stdin" : file;
    let data: unknown;
    try {
      data = YAML.parse(file === "-" ? io.stdin() : readFileSync(resolve(io.cwd, file), "utf8"));
    } catch (e) {
      throw new UsageError(`can't read ops from ${where}: ${(e as Error).message.split("\n")[0]}`);
    }
    const arr = Array.isArray(data) ? data : (data as { ops?: unknown } | null)?.ops;
    if (!Array.isArray(arr)) throw new UsageError("the ops file must be a list of ops (or { ops: [...] })");
    list.push(...arr);
  }
  if (!list.length) throw new UsageError("no ops given (use a file, - for stdin, or --op)");
  return list;
}

export async function run(argv: string[], io: IO = defaultIO): Promise<number | null> {
  let json = false;
  try {
    const a = parseArgs(argv);
    json = a.flags.json === true;
    if (a.flags.version) { io.out(VERSION + "\n"); return 0; }
    if (a.flags.help || !a.command) { io.out(HELP); return a.command || a.flags.help ? 0 : 2; }
    const root = resolve(io.cwd, typeof a.flags.project === "string" ? a.flags.project : ".");
    const allowScripts = a.flags["allow-scripts"] === true;
    const ws = () => ops.openWorkspace(root, { allowScripts });
    const str = (k: string) => (typeof a.flags[k] === "string" ? (a.flags[k] as string) : undefined);
    const P = a.positional;

    let result: any;
    let failed = false;
    switch (a.command) {
      case "init": {
        const config = join(root, ops.CONFIG_FILE);
        if (existsSync(config)) throw new OpError(`${ops.CONFIG_FILE} already exists`, [{ severity: "error", code: "exists", message: `${config} already exists` }]);
        mkdirSync(root, { recursive: true });
        writeFileSync(config, ops.configTemplate());
        mkdirSync(join(root, "models"), { recursive: true });
        result = { config, models: join(root, "models") };
        break;
      }
      case "new": result = ops.createModel(ws(), { name: need(P, 0, "model name"), from: str("from") }); break;
      case "list": result = ops.listModels(ws()); break;
      case "inspect": result = ops.inspectModel(ws(), { model: need(P, 0, "model name"), part: str("part") }); break;
      case "edit": result = ops.editModel(ws(), { model: need(P, 0, "model name"), ops: readOps(P[1], a.ops, io) }); break;
      case "undo": result = ops.undoModel(ws(), { model: need(P, 0, "model name") }); break;
      case "redo": result = ops.redoModel(ws(), { model: need(P, 0, "model name") }); break;
      case "capture": {
        const size = str("size") !== undefined ? Number(str("size")) : undefined;
        result = ops.capture(ws(), { model: need(P, 0, "model name"), part: str("part"), views: parseViews(str("views")), size });
        failed = result.issues.some((i: Issue) => i.severity === "error");
        break;
      }
      case "export": result = ops.exportModel(ws(), {
        model: need(P, 0, "model name"), out: str("out"), part: str("part"),
        formats: str("format")?.split(",") as ("glb" | "usdz")[] | undefined,
      }); break;
      case "build": result = ops.buildProject(ws(), { models: P }); failed = result.failed.length > 0; break;
      case "describe": result = ops.describe({ topic: P[0] }); break;
      case "schema": io.out(JSON.stringify(modelJsonSchema(), null, 2) + "\n"); return 0;
      case "mcp": await startMcpServer(root, allowScripts); return null;
      default: throw new UsageError(`unknown command "${a.command}" (see modelgen --help)`);
    }
    io.out(json ? JSON.stringify(ops.toJson(result), null, 2) + "\n" : human(a.command, result));
    const issues: Issue[] = result.issues ?? result.failed?.flatMap((f: any) => f.issues.map((i: Issue) => ({ ...i, part: i.part ?? f.model }))) ?? [];
    if (!json && issues.length) io.err(formatIssues(issues));
    return failed ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError) { io.err(`modelgen: ${e.message}\n`); return 2; }
    if (e instanceof OpError) {
      if (json) io.out(JSON.stringify({ error: e.message, issues: e.issues }, null, 2) + "\n");
      else io.err(`modelgen: ${e.message}\n${formatIssues(e.issues)}`);
      return 1;
    }
    // Backstop: anything else is reported like an operation error rather than a stack trace.
    const err = ops.internalError(e);
    if (json) io.out(JSON.stringify({ error: err.message, issues: err.issues }, null, 2) + "\n");
    else io.err(`modelgen: ${err.message}\n${formatIssues(err.issues)}`);
    return 1;
  }
}
