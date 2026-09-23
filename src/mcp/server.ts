import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { OpError } from "../document";
import * as ops from "../ops";
import { VERSION } from "../version";

const INSTRUCTIONS = `modelgen builds 3D models (GLB, USDZ) from validated operations.
Workflow: create_model → edit_model (batches of ops, applied atomically) → capture (look at the PNG and fix every issue) → export.
Conventions: meters, +y up, +z front, radians, #rrggbb colors. Group origins are pivots.
Call describe (topics: shapes, materials, patterns, ops, conventions, project, scripts, schema) before building if unsure.
Keep parts touching: a floating part is an error that blocks export.`;

type Shape = Record<string, z.ZodTypeAny>;

export function createServer(root: string, allowScripts: boolean): McpServer {
  const server = new McpServer({ name: "modelgen", version: VERSION }, { instructions: INSTRUCTIONS });
  const ws = () => ops.openWorkspace(root, { allowScripts });

  const tool = (name: string, description: string, inputSchema: Shape, fn: (args: any) => any, readOnly = false) =>
    server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: readOnly } }, async (args: any) => {
      try {
        const result = fn(args);
        const content: any[] = [{ type: "text", text: JSON.stringify(ops.toJson(result), null, 2) }];
        if (result?.png instanceof Buffer) content.push({ type: "image", data: result.png.toString("base64"), mimeType: "image/png" });
        return { content };
      } catch (e) {
        const err = e instanceof OpError ? e : ops.internalError(e);
        return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: err.message, issues: err.issues }, null, 2) }] };
      }
    });

  const model = z.string().describe("model name");
  const part = z.string().optional().describe("limit to this part and its children");

  tool("describe", "How modelgen works: shapes, materials, edit ops, conventions, project config, scripts, or the JSON Schema of a model.",
    { topic: z.enum(ops.TOPICS as [string, ...string[]]).optional() }, a => ops.describe(a), true);
  tool("create_model", "Create an empty model (or a copy of another with `from`).",
    { name: z.string().describe("lowercase letters, digits, _ and -"), from: z.string().optional() }, a => ops.createModel(ws(), a));
  // Only describe is read-only: list/inspect record hand edits as undo steps, capture writes a preview.
  tool("list_models", "List the models in the project.", {}, () => ops.listModels(ws()));
  tool("inspect_model", "Hierarchy, shapes, materials and world-space bounds of a model.", { model, part }, a => ops.inspectModel(ws(), a));
  tool("edit_model", `Apply up to ${ops.MAX_OPS} ops to a model atomically (one undo step). Ops: add, update, remove, rename, reparent, duplicate, set_material, remove_material, set. See describe topics ops and shapes.`,
    { model, ops: z.array(ops.EditOpSchema).min(1).max(ops.MAX_OPS) }, a => ops.editModel(ws(), a));
  tool("undo", "Undo the last edit of a model.", { model }, a => ops.undoModel(ws(), a));
  tool("redo", "Redo the last undone edit of a model.", { model }, a => ops.redoModel(ws(), a));
  tool("capture", "Render the model (PNG contact sheet) and report problems. Returns the image, each part's pixel position per view, bounds and issues.",
    {
      model, part,
      views: z.union([z.enum(Object.keys(ops.VIEW_PRESETS) as [string, ...string[]]), z.array(z.tuple([z.number(), z.number()])).min(1).max(12)]).optional()
        .describe("preset or [yaw, pitch] degree pairs; yaw 0 looks at the front"),
      size: z.number().int().min(64).max(1024).optional().describe("pixels per view (default 360)"),
    }, a => ops.capture(ws(), a));
  tool("export", "Write the model as GLB and/or USDZ files (plus anchors/life JSON when the model declares them).",
    { model, formats: z.array(z.enum(["glb", "usdz"])).optional(), out: z.string().describe("output directory, relative to the project"), part }, a => ops.exportModel(ws(), a));
  tool("build", "Export every output configured in modelgen.yaml (optionally only some models).",
    { models: z.array(z.string()).optional() }, a => ops.buildProject(ws(), a));
  return server;
}

export async function startMcpServer(root: string, allowScripts: boolean): Promise<void> {
  await createServer(root, allowScripts).connect(new StdioServerTransport());
}
