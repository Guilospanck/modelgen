export class UsageError extends Error {
  constructor(message: string) { super(message); this.name = "UsageError"; }
}

export type Parsed = { command?: string; positional: string[]; flags: Record<string, string | true>; ops: string[] };

const VALUE_FLAGS = new Set(["project", "part", "views", "size", "format", "out", "from", "op"]);
const BOOL_FLAGS = new Set(["json", "allow-scripts", "help", "version"]);

export function parseArgs(argv: string[]): Parsed {
  const p: Parsed = { positional: [], flags: {}, ops: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") { p.flags.help = true; continue; }
    if (a === "-v") { p.flags.version = true; continue; }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = a.slice(2, eq > 0 ? eq : undefined);
      if (BOOL_FLAGS.has(name)) { p.flags[name] = true; continue; }
      if (!VALUE_FLAGS.has(name)) throw new UsageError(`unknown option --${name}`);
      const value = eq > 0 ? a.slice(eq + 1) : argv[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
      if (name === "op") p.ops.push(value); else p.flags[name] = value;
      continue;
    }
    if (p.command === undefined) p.command = a; else p.positional.push(a);
  }
  return p;
}
