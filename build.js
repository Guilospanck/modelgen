// Builder → validated model file. A builder is a module exporting a function
// that returns { parts, textures } (see README). buildModel() checks it,
// assembles it, writes USDZ or GLB bytes and validates them.
"use strict";
const fs = require("fs");
const path = require("path");
const { assemble, assembleTransform, usda, usdz, paintSkin } = require("./lib");
const { glb } = require("./gltf");

// Every <dir>/*.js module as a builder, keyed by file name, sorted. Helper
// modules that are not builders themselves go in `exclude`.
function loadBuilders(dir, { exclude = [] } = {}) {
  const builders = {};
  for (const f of fs.readdirSync(dir).sort()) {
    if (f.endsWith(".js") && !exclude.includes(f)) builders[f.slice(0, -3)] = require(path.resolve(dir, f));
  }
  return builders;
}

// Connectivity: every part must touch/overlap another so nothing floats.
// Two parts connect if their 12%-shrunk bounding boxes overlap or any sampled
// vertices come within 4% of the model's size.
function connectivityIssues(parts) {
  const boxes = parts.map(p => {
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const v of p.mesh.pos)
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
    return { mn, mx };
  });
  let size = 0;
  for (const b of boxes) for (let k = 0; k < 3; k++) size = Math.max(size, b.mx[k] - b.mn[k]);
  const eps = size * 0.04;
  const samples = parts.map(p => {
    const st = Math.max(1, Math.floor(p.mesh.pos.length / 400));
    const out = [];
    for (let i = 0; i < p.mesh.pos.length; i += st) out.push(p.mesh.pos[i]);
    return out;
  });
  const overlap = (a, b) => {
    for (let k = 0; k < 3; k++) {
      const sa = (a.mx[k] - a.mn[k]) * 0.12, sb = (b.mx[k] - b.mn[k]) * 0.12;
      if (a.mn[k] + sa > b.mx[k] - sb || b.mn[k] + sb > a.mx[k] - sa) return false;
    }
    return true;
  };
  // a sampled vertex of one part sitting inside the other's (slightly shrunk)
  // bbox counts as attached — catches roots buried deep in a parent mass
  const embedded = (i, j) => {
    const b = boxes[j], s = [0, 1, 2].map(k => (b.mx[k] - b.mn[k]) * 0.02);
    for (const v of samples[i]) {
      let inside = true;
      for (let k = 0; k < 3; k++) if (v[k] < b.mn[k] + s[k] || v[k] > b.mx[k] - s[k]) { inside = false; break; }
      if (inside) return true;
    }
    return false;
  };
  const near = (i, j) => {
    for (const a of samples[i])
      for (const b of samples[j]) {
        const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        if (dx * dx + dy * dy + dz * dz < eps * eps) return true;
      }
    return false;
  };
  const parent = parts.map((_, i) => i);
  const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++)
      if (find(i) !== find(j) && (overlap(boxes[i], boxes[j]) || embedded(i, j) || embedded(j, i) || near(i, j))) parent[find(j)] = find(i);
  const comps = new Map();
  parts.forEach((_, i) => { const r = find(i); comps.set(r, (comps.get(r) || 0) + 1); });
  if (comps.size <= 1) return null;
  const rootOfLargest = [...comps.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const stray = parts.map((p, i) => ({ i, color: p.color, root: find(i) })).filter(e => e.root !== rootOfLargest);
  return `${comps.size} components; floating parts: ${stray.map(e => `#${e.i}(${e.color})`).join(", ")}`;
}

// assemble() always recenters + rescales to bbox-centre / maxdim 2. That is
// right for a whole model (apps recenter again on load) but wrong for an
// attachment, whose local origin (the mount point) and nominal ~1.0 size ARE
// its contract with the anchors. keepOrigin inverts exactly what assemble()
// did, using the same ctr/s: assemble maps v -> (v - ctr) * s, so the inverse
// is v -> pos / s + ctr.
function undoAssembleNormalize(groups, parts) {
  const { ctr, s } = assembleTransform(parts);
  for (const g of groups) g.pos = g.pos.map(p => [p[0] / s + ctr[0], p[1] / s + ctr[1], p[2] / s + ctr[2]]);
}

function bboxOf(pts) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const v of pts) for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
  return { mn, mx };
}

// keepOrigin guard: the positions written into the file must span the
// authored parts' own bbox. 2e-3 tolerance because usda() writes 3 decimals.
function checkRoundTrip(parts, shippedPts) {
  const authored = bboxOf(parts.flatMap(p => p.mesh.pos));
  const shipped = bboxOf(shippedPts);
  const tol = 2e-3;
  const bad = [];
  for (let k = 0; k < 3; k++) {
    if (Math.abs(authored.mn[k] - shipped.mn[k]) > tol) bad.push(`mn[${k}] authored=${authored.mn[k]} shipped=${shipped.mn[k]}`);
    if (Math.abs(authored.mx[k] - shipped.mx[k]) > tol) bad.push(`mx[${k}] authored=${authored.mx[k]} shipped=${shipped.mx[k]}`);
  }
  if (bad.length) throw new Error("ROUND-TRIP SEAM FAIL: " + bad.join("; "));
}

function parseUsdaPoints(usdaText) {
  const pts = [];
  const re = /point3f\[\] points = \[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(usdaText))) {
    const nums = m[1].match(/\(([^()]+)\)/g) || [];
    for (const n of nums) pts.push(n.slice(1, -1).split(",").map(Number));
  }
  return pts;
}

// Stored zip, every entry 64-byte aligned, usda first, png payloads real PNGs.
function validateUsdz(b, expectedEntries) {
  let off = 0, entries = 0, aligned = true;
  const issues = [];
  while (off + 4 <= b.length && b.readUInt32LE(off) === 0x04034b50) {
    const size = b.readUInt32LE(off + 18);
    const nameLen = b.readUInt16LE(off + 26), extraLen = b.readUInt16LE(off + 28);
    const dataOff = off + 30 + nameLen + extraLen;
    if (dataOff % 64 !== 0) aligned = false;
    const ename = b.toString("utf8", off + 30, off + 30 + nameLen);
    if (entries === 0 && !b.subarray(dataOff, dataOff + 9).equals(Buffer.from("#usda 1.0"))) issues.push("first entry not usda");
    if (ename.endsWith(".png") && b.readUInt32BE(dataOff) !== 0x89504e47) issues.push(ename + " not png");
    entries++;
    off = dataOff + size;
  }
  const eocdOk = b.readUInt32LE(b.length - 22) === 0x06054b50;
  if (!aligned) issues.push("entries not 64-byte aligned");
  if (!eocdOk) issues.push("no end-of-central-directory record");
  if (expectedEntries !== undefined && entries !== expectedEntries) issues.push(`${entries} entries, expected ${expectedEntries}`);
  return issues;
}

// glTF 2.0 binary: header, JSON chunk, BIN chunk, sizes consistent.
function validateGlb(b) {
  const issues = [];
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

// Check a builder's output, assemble it and encode it.
//   format      "usdz" | "glb"
//   keepOrigin  keep the authored origin and scale (attachments)
//   connectivity  reject floating parts (default on; `surf` parts are exempt)
// Returns { data: Buffer, stats }. Throws on any problem.
function buildModel({ parts, textures }, { format = "usdz", keepOrigin = false, connectivity = true } = {}) {
  for (const p of parts) {
    if (!p || !p.color || !/^#[0-9a-f]{6}$/i.test(p.color)) throw new Error("bad part/color");
    if (p.tex && !(textures && textures[p.tex])) throw new Error(`part references missing texture "${p.tex}"`);
  }
  if (connectivity) {
    const conn = connectivityIssues(parts.filter(p => !p.surf)); // surface tufts are attached by construction
    if (conn) throw new Error("DISCONNECTED: " + conn);
  }
  const groups = assemble(parts);
  if (keepOrigin) undoAssembleNormalize(groups, parts);
  const skins = {};
  for (const [id, spec] of Object.entries(textures || {})) skins[id] = paintSkin(spec);

  let data, issues;
  if (format === "usdz") {
    const text = usda(groups);
    if (keepOrigin) checkRoundTrip(parts, parseUsdaPoints(text));
    const entries = [{ name: "model.usda", data: Buffer.from(text, "utf8") }];
    for (const [id, t] of Object.entries(skins)) {
      entries.push({ name: `textures/${id}.png`, data: t.diffuse });
      entries.push({ name: `textures/${id}_n.png`, data: t.normal });
    }
    data = usdz(entries);
    issues = validateUsdz(data, Object.keys(skins).length * 2 + 1);
  } else if (format === "glb") {
    if (keepOrigin) checkRoundTrip(parts, groups.flatMap(g => g.pos));
    data = glb(groups, skins);
    issues = validateGlb(data);
  } else {
    throw new Error(`unknown format "${format}"`);
  }
  if (issues.length) throw new Error("INVALID " + format + ": " + issues.join("; "));
  return {
    data,
    stats: {
      mats: groups.length, tex: Object.keys(textures || {}).length,
      verts: groups.reduce((a, g) => a + g.pos.length, 0),
      tris: groups.reduce((a, g) => a + g.idx.length / 3, 0),
    },
  };
}

// Build every builder (or just `only`) into `outDir` as <prefix><name>.<ext>
// per format, logging a table. Returns the number of failures.
function buildAll(builders, { outDir, formats = ["usdz"], prefix = "", only = [], keepOrigin = false, log = console.log } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  let totalBytes = 0, fail = 0, built = 0;
  for (const [name, build] of Object.entries(builders)) {
    if (only.length && !only.includes(name)) continue;
    try {
      const model = build();
      const sizes = [];
      let stats;
      for (const format of formats) {
        const r = buildModel(model, { format, keepOrigin });
        fs.writeFileSync(path.join(outDir, `${prefix}${name}.${format}`), r.data);
        totalBytes += r.data.length;
        sizes.push(`${format} ${Math.round(r.data.length / 1024)} KB`);
        stats = r.stats;
      }
      built++;
      log(`${name.padEnd(26)} mats=${String(stats.mats).padStart(2)} tex=${stats.tex} verts=${String(stats.verts).padStart(6)} tris=${String(stats.tris).padStart(6)} ${sizes.join(", ")}`);
    } catch (e) {
      fail++;
      console.error("FAIL", name, e.message);
    }
  }
  log(`\n${built} models, ${(totalBytes / 1024 / 1024).toFixed(1)} MB total, ${fail} failures`);
  return fail;
}

module.exports = { loadBuilders, connectivityIssues, buildModel, buildAll, validateUsdz, validateGlb };
