// @ts-nocheck — body ported from gltf.js; Task 7 adds glbScene
import type { Group, Skin } from "../engine/types";

const hexToLinear = hex => {
  const c = parseInt(hex.slice(1), 16);
  const f = v => Math.pow(v / 255, 2.2);
  return [f((c >> 16) & 255), f((c >> 8) & 255), f(c & 255)];
};

const FLOAT = 5126, UINT = 5125, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963, REPEAT = 10497;

// groups: assemble() output; skins: { texId: { diffuse: PNG, normal: PNG } }
function glb(groups, skins = {}) {
  const chunks = [];
  let byteLength = 0;
  const bufferViews = [], accessors = [];
  const view = (buf, target) => {
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { chunks.push(Buffer.alloc(pad)); byteLength += pad; }
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buf.length, ...(target ? { target } : {}) });
    chunks.push(buf);
    byteLength += buf.length;
    return bufferViews.length - 1;
  };
  const vec = (rows, n, withBounds) => {
    const a = new Float32Array(rows.length * n);
    rows.forEach((r, i) => { for (let k = 0; k < n; k++) a[i * n + k] = r[k]; });
    const acc = { bufferView: view(Buffer.from(a.buffer), ARRAY_BUFFER), componentType: FLOAT, count: rows.length, type: n === 3 ? "VEC3" : "VEC2" };
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
  const unit = v => { const l = Math.hypot(v[0], v[1], v[2]); return l > 1e-8 ? [v[0] / l, v[1] / l, v[2] / l] : [0, 1, 0]; };

  // Textures: one image + texture per PNG, shared across groups using the same skin.
  const images = [], textures = [], texIndex = {};
  const addTexture = (key, png) => {
    if (texIndex[key] === undefined) {
      images.push({ bufferView: view(png), mimeType: "image/png", name: key });
      textures.push({ sampler: 0, source: images.length - 1 });
      texIndex[key] = textures.length - 1;
    }
    return texIndex[key];
  };

  const materials = [], primitives = [];
  groups.forEach((g, gi) => {
    const pbr = { metallicFactor: g.metal, roughnessFactor: g.rough };
    const mat = { name: `mat${gi}`, pbrMetallicRoughness: pbr, doubleSided: true };
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
    const idx = Buffer.from(new Uint32Array(g.idx).buffer);
    accessors.push({ bufferView: view(idx, ELEMENT_ARRAY_BUFFER), componentType: UINT, count: g.idx.length, type: "SCALAR" });
    primitives.push({ attributes, indices: accessors.length - 1, material: gi });
  });

  const pad4 = n => (4 - (n % 4)) % 4;
  const tail = pad4(byteLength);
  if (tail) { chunks.push(Buffer.alloc(tail)); byteLength += tail; }

  const doc = {
    asset: { version: "2.0", generator: "modelgen" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: "Root", mesh: 0 }],
    meshes: [{ primitives }],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
    ...(images.length ? { images, textures, samplers: [{ wrapS: REPEAT, wrapT: REPEAT }] } : {}),
  };
  let json = Buffer.from(JSON.stringify(doc), "utf8");
  json = Buffer.concat([json, Buffer.alloc(pad4(json.length), 0x20)]);
  const bin = Buffer.concat(chunks);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + json.length + 8 + bin.length, 8);
  const chunkHead = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  return Buffer.concat([header, chunkHead(json.length, 0x4e4f534a), json, chunkHead(bin.length, 0x004e4942), bin]);
}

export { glb };

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
