// Builds the browser bundle and the demo site into web-dist/ (or the dir given as the first argument).
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(__dirname, "..");

export async function buildWeb(outdir = join(root, "web-dist")): Promise<void> {
  rmSync(outdir, { recursive: true, force: true });
  mkdirSync(outdir, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(root, "scripts/web/entry.ts")],
    outdir,
    naming: "modelgen.js",
    target: "browser",
    format: "esm",
    minify: true,
    plugins: [{
      name: "node-builtins",
      setup(b) {
        b.onResolve({ filter: /^(node:)?zlib$/ }, () => ({ path: join(root, "scripts/web/zlib.ts") }));
        // Anything else from Node would be silently stubbed by the bundler and break at runtime.
        b.onResolve({ filter: /^node:/ }, a => { throw new Error(`${a.importer} imports ${a.path}; the web build can't use Node modules`); });
      },
    }],
  });
  if (!result.success) throw new AggregateError(result.logs, "web build failed");

  cpSync(join(root, "site"), outdir, { recursive: true });
  cpSync(join(root, "LICENSE-fonts.txt"), join(outdir, "LICENSE-fonts.txt"));
  // Script parts can't run in the browser, so their examples stay out of the demo.
  const dir = join(root, "examples");
  const examples = readdirSync(dir).filter(f => f.endsWith(".model.yaml")).sort()
    .map(f => ({ name: f.replace(".model.yaml", ""), text: readFileSync(join(dir, f), "utf8") }))
    .filter(e => !/^\s*script:/m.test(e.text));
  writeFileSync(join(outdir, "examples.json"), JSON.stringify(examples));
}

// No top-level await: the package compiles as CommonJS and tsconfig type-checks scripts/.
if (require.main === module) buildWeb(process.argv[2] && resolve(process.argv[2])).then(() => console.log("web build ok"));
