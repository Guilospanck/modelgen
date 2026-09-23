import type { Group, Skin } from "../engine/types";

// glTF 2.0 binary (.glb): a node tree with meshes (one primitive per material
// group), PBR materials, embedded PNG textures. Colors are linear, like usda().
export type GlbNode = { name: string; translation?: number[]; rotation?: number[]; scale?: number[]; groups?: Group[]; children?: GlbNode[] };

const hexToLinear = (hex: string) => {
  const c = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.pow(v / 255, 2.2);
  return [f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255)];
};

const FLOAT = 5126, UINT = 5125, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963, REPEAT = 10497;

export function glbScene(roots: GlbNode[], skins: Record<string, Skin> = {}): Buffer {
  const chunks: Buffer[] = [];
  let byteLength = 0;
  const bufferViews: any[] = [], accessors: any[] = [];
  const view = (buf: Buffer, target?: number) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf);
    byteLength += buf.length;
    return bufferViews.length - 1;
  };
  const vec = (rows: number[][], n: number, withBounds = false) => {
    const a = new Float32Array(rows.length * n);
    rows.forEach((r, i) => { for (let k = 0; k < n; k++) a[i * n + k] = r[k]; });
    const acc: any = { bufferView: view(Buffer.from(a.buffer), ARRAY_BUFFER), componentType: FLOAT, count: rows.length, type: n === 3 ? "VEC3" : "VEC2" };
    if (withBounds) {
      // bounds of the float32 values actually stored (validators compare exactly)
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < rows.length; i++)
        for (let k = 0; k < 3; k++) { const v = a[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
      acc.min = mn; acc.max = mx;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const unit = (v: number[]) => { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-8 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0]; };

  const images: any[] = [], textures: any[] = [], texIndex: Record<string, number> = {};
  const addTexture = (key: string, png: Buffer) => {
    if (texIndex[key] === undefined) {
      images.push({ bufferView: view(png), mimeType: "image/png", name: key });
      textures.push({ sampler: 0, source: images.length - 1 });
      texIndex[key] = textures.length - 1;
    }
    return texIndex[key];
  };

  const materials: any[] = [], meshes: any[] = [], nodes: any[] = [];
  const primitive = (g: Group) => {
    const pbr: any = { metallicFactor: g.metal, roughnessFactor: g.rough };
    const mat: any = { name: `mat${materials.length}`, pbrMetallicRoughness: pbr, doubleSided: true };
    if (g.tex && skins[g.tex]) {
      pbr.baseColorFactor = [1, 1, 1, g.opacity];
      pbr.baseColorTexture = { index: addTexture(g.tex, skins[g.tex].diffuse) };
      mat.normalTexture = { index: addTexture(g.tex + "_n", skins[g.tex].normal) };
    } else {
      pbr.baseColorFactor = [...hexToLinear(g.color), g.opacity];
    }
    if (g.emissive) mat.emissiveFactor = hexToLinear(g.emissive);
    if (g.opacity < 1) mat.alphaMode = "BLEND";
    materials.push(mat);
    const attributes = { POSITION: vec(g.pos, 3, true), NORMAL: vec(g.nrm.map(unit), 3), TEXCOORD_0: vec(g.uv, 2) };
    accessors.push({ bufferView: view(Buffer.from(new Uint32Array(g.idx).buffer), ELEMENT_ARRAY_BUFFER), componentType: UINT, count: g.idx.length, type: "SCALAR" });
    return { attributes, indices: accessors.length - 1, material: materials.length - 1 };
  };
  const addNode = (n: GlbNode): number => {
    const node: any = { name: n.name };
    const index = nodes.push(node) - 1;
    if (n.translation && n.translation.some(v => v !== 0)) node.translation = n.translation;
    if (n.rotation && (n.rotation[0] || n.rotation[1] || n.rotation[2])) node.rotation = n.rotation;
    if (n.scale && n.scale.some(v => v !== 1)) node.scale = n.scale;
    if (n.groups && n.groups.length) node.mesh = meshes.push({ primitives: n.groups.map(primitive) }) - 1;
    if (n.children && n.children.length) node.children = n.children.map(addNode);
    return index;
  };
  const sceneNodes = roots.map(addNode);

  const pad4 = (n: number) => (4 - (n % 4)) % 4;
  const tail = pad4(byteLength);
  if (tail) { chunks.push(Buffer.alloc(tail)); byteLength += tail; }
  const doc = {
    asset: { version: "2.0", generator: "modelgen" },
    scene: 0,
    scenes: [{ nodes: sceneNodes }],
    nodes, meshes, materials, accessors, bufferViews,
    buffers: [{ byteLength }],
    ...(images.length ? { images, textures, samplers: [{ wrapS: REPEAT, wrapT: REPEAT }] } : {}),
  };
  let json = Buffer.from(JSON.stringify(doc), "utf8");
  json = Buffer.concat([json, Buffer.alloc(pad4(json.length), 0x20)]);
  const bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunkHead = (len: number, type: number) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([header, chunkHead(json.length, 0x4e4f534a), json, chunkHead(bin.length, 0x004e4942), bin]);
}

// Flat model: one node, one mesh (the pre-hierarchy layout).
export function glb(groups: Group[], skins: Record<string, Skin> = {}): Buffer {
  return glbScene([{ name: "Root", groups }], skins);
}

// glTF 2.0 binary: header, JSON chunk, BIN chunk, sizes consistent.
export function validateGlb(b: Buffer): string[] {
  const issues: string[] = [];
  if (b.length < 28) return ["too short"];
  if (b.readUInt32LE(0) !== 0x46546c67) issues.push("bad magic");
  if (b.readUInt32LE(4) !== 2) issues.push("not glTF 2");
  if (b.readUInt32LE(8) !== b.length) issues.push("length mismatch");
  const jsonLen = b.readUInt32LE(12);
  if (b.readUInt32LE(16) !== 0x4e4f534a) issues.push("first chunk not JSON");
  let doc;
  try { doc = JSON.parse(b.toString("utf8", 20, 20 + jsonLen)); } catch { issues.push("JSON chunk does not parse"); return issues; }
  const binOff = 20 + jsonLen;
  if (b.readUInt32LE(binOff + 4) !== 0x004e4942) issues.push("second chunk not BIN");
  if (b.readUInt32LE(binOff) < doc.buffers[0].byteLength) issues.push("BIN chunk shorter than buffer");
  return issues;
}

export function glbJson(b: Buffer): any {
  return JSON.parse(b.toString("utf8", 20, 20 + b.readUInt32LE(12)));
}
