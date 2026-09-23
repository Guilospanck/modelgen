import { test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/mcp/server";

const project = mkdtempSync(join(tmpdir(), "modelgen-mcp-"));
const client = new Client({ name: "test", version: "0" });
beforeAll(async () => {
  await client.connect(new StdioClientTransport({ command: "bun", args: ["run", join(__dirname, "../src/cli/bin.ts"), "mcp", "--project", project] }));
});
afterAll(() => client.close());

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r: any = await client.callTool({ name, arguments: args });
  const text = r.content.find((c: any) => c.type === "text")?.text;
  return { isError: r.isError === true, json: text ? JSON.parse(text) : undefined, content: r.content };
};

test("lists every tool", async () => {
  const names = (await client.listTools()).tools.map(t => t.name).sort();
  expect(names).toEqual(["build", "capture", "create_model", "describe", "edit_model", "export", "inspect_model", "list_models", "redo", "undo"]);
});

test("the lantern session end to end", async () => {
  expect((await call("create_model", { name: "lantern" })).json.model).toBe("lantern");
  const edit = await call("edit_model", { model: "lantern", ops: [
    { set_material: { name: "paper", material: { color: "#e8a13a", emissive: "#6a3a08", texture: { pattern: "stripes", color: "#c4761f" } } } },
    { set_material: { name: "iron", material: { color: "#2a2a2a", metalness: 0.8, roughness: 0.3 } } },
    { add: { part: { name: "base", box: { size: [0.4, 0.06, 0.4] }, material: "iron" } } },
    { add: { part: { name: "body", lathe: { profile: [[0, 0], [0.2, 0.1], [0.25, 0.4], [0.15, 0.7], [0, 0.72]] }, material: "paper" } } }, // starts inside the base
    { add: { part: { name: "handle", tube: { path: [[-0.1, 0.62, 0], [0, 0.85, 0], [0.1, 0.62, 0]], radius: 0.012 }, material: "iron" } } },
  ] });
  expect(edit.isError).toBe(false);
  const cap = await call("capture", { model: "lantern", size: 160 });
  expect(cap.content.some((c: any) => c.type === "image" && c.mimeType === "image/png" && c.data.length > 1000)).toBe(true);
  expect(cap.json.issues).toEqual([]);
  const out = join(project, "assets");
  const exp = await call("export", { model: "lantern", formats: ["glb", "usdz"], out });
  expect(exp.isError).toBe(false);
  expect(existsSync(join(out, "lantern.glb"))).toBe(true);
  expect((await call("inspect_model", { model: "lantern" })).json.parts.length).toBe(3);
  expect((await call("undo", { model: "lantern" })).json.undo).toBe(0);
});

test("errors come back as isError with issues", async () => {
  const r = await call("edit_model", { model: "lantern", ops: [{ remove: { name: "ghost" } }] });
  expect(r.isError).toBe(true);
  expect(r.json.issues[0].code).toBe("not_found");
  const s = await call("edit_model", { model: "lantern", ops: [{ add: { part: { name: "s", script: { module: "x.js" } } } }] });
  expect(s.json.issues[0].code).toBe("scripts_disabled");
  expect((await call("describe", { topic: "shapes" })).json.text).toContain("lathe");
});

test("unexpected errors come back as isError with an internal issue", async () => {
  const broken = mkdtempSync(join(tmpdir(), "modelgen-mcp-broken-"));
  mkdirSync(join(broken, "modelgen.yaml")); // a directory where the config file should be
  const [a, b] = InMemoryTransport.createLinkedPair();
  const c = new Client({ name: "test", version: "0" });
  await Promise.all([createServer(broken, false).connect(a), c.connect(b)]);
  const r: any = await c.callTool({ name: "list_models", arguments: {} });
  expect(r.isError).toBe(true);
  const json = JSON.parse(r.content[0].text);
  expect(json.error).toBeDefined();
  expect(json.issues[0].code).toBe("internal");
  await c.close();
});

test("only describe is read-only", async () => {
  const tools = (await client.listTools()).tools;
  expect(tools.filter(t => t.annotations?.readOnlyHint === true).map(t => t.name)).toEqual(["describe"]);
});
