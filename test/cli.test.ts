import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../src/cli/main";
import { VERSION } from "../src/version";

const session = () => {
  const cwd = mkdtempSync(join(tmpdir(), "modelgen-cli-"));
  let out = "", err = "", stdin = "";
  const io = { out: (s: string) => { out += s; }, err: (s: string) => { err += s; }, stdin: () => stdin, cwd };
  return {
    cwd,
    setStdin: (s: string) => { stdin = s; },
    async run(...argv: string[]) { out = ""; err = ""; const code = await run(argv, io); return { code, out, err }; },
  };
};
const BODY = JSON.stringify({ add: { part: { name: "body", lathe: { profile: [[0, 0], [0.3, 0.4], [0, 0.8]] } } } });

test("version and help", async () => {
  const s = session();
  expect((await s.run("--version")).out.trim()).toBe(VERSION);
  expect((await s.run("--help")).out).toContain("modelgen <command>");
  expect(JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf8")).version).toBe(VERSION);
});

test("init, new, edit (--op and stdin), inspect, capture, export, build", async () => {
  const s = session();
  expect((await s.run("init")).code).toBe(0);
  expect(existsSync(join(s.cwd, "modelgen.yaml"))).toBe(true);
  expect((await s.run("new", "vase")).out).toContain("vase.model.yaml");
  expect((await s.run("edit", "vase", "--op", BODY)).code).toBe(0);
  s.setStdin("- set_material: { name: clay, material: { color: '#b5651d' } }\n- update: { name: body, set: { material: clay } }\n");
  expect((await s.run("edit", "vase", "-")).out).toContain("2 ops applied");
  const inspect = JSON.parse((await s.run("inspect", "vase", "--json")).out);
  expect(inspect.parts[0]).toMatchObject({ name: "body", shape: "lathe", material: "clay" });
  const cap = await s.run("capture", "vase", "--views", "0:5,90:5", "--size", "128", "--json");
  expect(cap.code).toBe(0);
  expect(JSON.parse(cap.out).image.views).toEqual([[0, 5], [90, 5]]);
  const exp = await s.run("export", "vase", "--out", "dist", "--format", "glb,usdz");
  expect(exp.code).toBe(0);
  expect(existsSync(join(s.cwd, "dist/vase.usdz"))).toBe(true);
  expect((await s.run("build")).code).toBe(0);
  expect(existsSync(join(s.cwd, "build/models/vase.glb"))).toBe(true);
});

test("errors: usage → 2, operation → 1 with hints, --json errors are JSON", async () => {
  const s = session();
  expect((await s.run("frobnicate")).code).toBe(2);
  expect((await s.run("capture")).code).toBe(2);
  expect((await s.run("new", "x", "--bogus")).code).toBe(2);
  const miss = await s.run("inspect", "ghost");
  expect(miss.code).toBe(1);
  expect(miss.err).toContain('no model named "ghost"');
  expect(miss.err).toContain("hint:");
  const j = await s.run("inspect", "ghost", "--json");
  expect(JSON.parse(j.out).issues[0].code).toBe("not_found");
});

test("capture exits 1 when the model has errors, but still writes the image", async () => {
  const s = session();
  await s.run("new", "m");
  await s.run("edit", "m", "--op", JSON.stringify({ add: { part: { name: "a", sphere: { radius: 0.1 } } } }),
    "--op", JSON.stringify({ add: { part: { name: "b", sphere: { radius: 0.1 }, position: [3, 0, 0] } } }));
  const r = await s.run("capture", "m");
  expect(r.code).toBe(1);
  expect(r.out).toContain("m.png");
  expect(r.err).toContain("floating");
});

test("an unreadable or broken ops file is a usage error", async () => {
  const s = session();
  await s.run("new", "m");
  const missing = await s.run("edit", "m", "nope.yaml");
  expect(missing.code).toBe(2);
  expect(missing.err).toContain("nope.yaml");
  writeFileSync(join(s.cwd, "ops.yaml"), "- add: [\n");
  const broken = await s.run("edit", "m", "ops.yaml");
  expect(broken.code).toBe(2);
  expect(broken.err).toContain("ops.yaml");
  s.setStdin("- add: [\n");
  expect((await s.run("edit", "m", "-")).code).toBe(2);
});

test("export --out pointing at a file is an operation error", async () => {
  const s = session();
  await s.run("new", "m");
  await s.run("edit", "m", "--op", BODY);
  writeFileSync(join(s.cwd, "taken"), "x");
  const r = await s.run("export", "m", "--out", "taken", "--json");
  expect(r.code).toBe(1);
  expect(JSON.parse(r.out).issues[0].code).toBe("io");
});

test("unexpected errors become an internal issue with exit 1", async () => {
  const s = session();
  mkdirSync(join(s.cwd, "modelgen.yaml")); // a directory where the config file should be
  const r = await s.run("list");
  expect(r.code).toBe(1);
  expect(r.err).toContain("internal");
  const j = await s.run("list", "--json");
  expect(j.code).toBe(1);
  expect(JSON.parse(j.out).issues[0].code).toBe("internal");
});

test("init creates a missing project directory", async () => {
  const s = session();
  expect((await s.run("init", "--project", "new/proj")).code).toBe(0);
  expect(existsSync(join(s.cwd, "new/proj/modelgen.yaml"))).toBe(true);
});
