// @ts-nocheck — ported engine; behaviour frozen by test/engine.golden.test.ts
// Software renderer: rasterizes a model to a PNG contact image so the
// generator's output can be SEEN and judged before it ships. Orthographic
// two-view (3/4 + profile), z-buffer, Gouraud lighting, texture sampling.
import * as lib from "./lib";
import { run } from "./life/dsl";

const hexRGB = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function viewBasis(yawDeg, pitchDeg) {
  const yaw = (yawDeg * Math.PI) / 180, pitch = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwd = [sy * cp, -sp, -cy * cp];               // looking direction
  const right = [cy, 0, sy];
  const up = [sy * sp, cp, -cy * sp];
  return { right, up, fwd };
}

// Screen position of a (normalized-space) point in a W×H view, matching renderView's projection.
function project(p, W, H, yaw, pitch) {
  const { right, up } = viewBasis(yaw, pitch);
  const scale = Math.min(W, H) / 2.6;
  return {
    x: W / 2 + (p[0] * right[0] + p[1] * right[1] + p[2] * right[2]) * scale,
    y: H / 2 + 8 - (p[0] * up[0] + p[1] * up[1] + p[2] * up[2]) * scale,
  };
}

function renderView(groups, texPix, W, H, yaw, pitch) {
  const img = new Float32Array(W * H * 3).fill(0.45); // mid-gray bg: dark AND light features must read
  const zbuf = new Float32Array(W * H).fill(-1e9);
  const { right, up, fwd } = viewBasis(yaw, pitch);
  const L = (() => { const l = [0.45, 0.75, 0.5]; const n = Math.hypot(...l); return l.map(v => v / n); })();
  const scale = Math.min(W, H) / 2.6;
  const cx = W / 2, cyc = H / 2 + 8;

  for (const g of groups) {
    const base = hexRGB(g.color);
    const emis = g.emissive ? hexRGB(g.emissive) : null;
    const tp = g.tex ? texPix[g.tex] : null;
    // per-vertex screen coords + lighting
    const n = g.pos.length;
    const sxA = new Float32Array(n), syA = new Float32Array(n), szA = new Float32Array(n), litA = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = g.pos[i], nm = g.nrm[i];
      sxA[i] = cx + (p[0] * right[0] + p[1] * right[1] + p[2] * right[2]) * scale;
      syA[i] = cyc - (p[0] * up[0] + p[1] * up[1] + p[2] * up[2]) * scale;
      szA[i] = -(p[0] * fwd[0] + p[1] * fwd[1] + p[2] * fwd[2]);
      const nd = Math.abs(nm[0] * L[0] + nm[1] * L[1] + nm[2] * L[2]); // double-sided
      litA[i] = 0.3 + 0.7 * nd;
    }
    for (let t = 0; t < g.idx.length; t += 3) {
      const a = g.idx[t], b = g.idx[t + 1], c = g.idx[t + 2];
      const x0 = sxA[a], y0 = syA[a], x1 = sxA[b], y1 = syA[b], x2 = sxA[c], y2 = syA[c];
      const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-9) continue;
      const inv = 1 / area;
      for (let py = minY; py <= maxY; py++)
        for (let px = minX; px <= maxX; px++) {
          const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
          const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
          const w2 = 1 - w0 - w1;
          if (w0 < 0 || w1 < 0 || w2 < 0) continue;
          const z = w0 * szA[a] + w1 * szA[b] + w2 * szA[c];
          const zi = py * W + px;
          if (z <= zbuf[zi]) continue;
          zbuf[zi] = z;
          let cr = base[0], cg = base[1], cb = base[2];
          if (tp) {
            const u = w0 * g.uv[a][0] + w1 * g.uv[b][0] + w2 * g.uv[c][0];
            const v = w0 * g.uv[a][1] + w1 * g.uv[b][1] + w2 * g.uv[c][1];
            const tx = Math.min(tp.W - 1, Math.max(0, Math.floor(((u % 1) + 1) % 1 * tp.W)));
            const ty = Math.min(tp.W - 1, Math.max(0, Math.floor(((v % 1) + 1) % 1 * tp.W)));
            const ti = (ty * tp.W + tx) * 4;
            cr = tp.px[ti]; cg = tp.px[ti + 1]; cb = tp.px[ti + 2];
          }
          const lit = w0 * litA[a] + w1 * litA[b] + w2 * litA[c];
          let r = cr * lit, gg = cg * lit, bb = cb * lit;
          if (emis) { r += emis[0] * 0.9; gg += emis[1] * 0.9; bb += emis[2] * 0.9; }
          const ii = zi * 3;
          img[ii] = Math.min(255, r) / 255;
          img[ii + 1] = Math.min(255, gg) / 255;
          img[ii + 2] = Math.min(255, bb) / 255;
        }
    }
  }
  return img;
}

function toPNG(views, W, H) {
  const total = W * views.length;
  const px = Buffer.alloc(total * H * 4);
  views.forEach((img, vi) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const si = (y * W + x) * 3;
        const di = (y * total + vi * W + x) * 4;
        px[di] = Math.round(img[si] * 255);
        px[di + 1] = Math.round(img[si + 1] * 255);
        px[di + 2] = Math.round(img[si + 2] * 255);
        px[di + 3] = 255;
      }
  });
  return lib.encodePNG(px, total, H);
}

// Default views (yaw 0 looks at the front, +z): 3/4 front, side profile, higher 3/4 front
// from the other side.
const VIEWS = [[335, 15], [270, 5], [25, 30]];

// Contact sheet of a builder's output ({ parts, textures }) as PNG bytes, one
// panel per [yaw, pitch] in `views` (degrees).
function preview({ parts, textures }, { W = 340, H = 340, tex = 256, views = VIEWS } = {}) {
  const groups = lib.assemble(parts);
  const texPix = {};
  for (const [id, spec] of Object.entries(textures || {})) texPix[id] = lib.paintSkin(spec, tex, true);
  return toPNG(views.map(([yaw, pitch]) => renderView(groups, texPix, W, H, yaw, pitch)), W, H);
}

// Frames of a life program (see life/dsl.js) across its cycle, as PNG bytes:
// one panel per time in `frames` (seconds), so the motion can be judged.
function lifePreview({ parts, textures }, prog, { frames = [0.6, 2.8, 5.2, 7.4, 9.9, 11.9, 13.7, 15.1], W = 200, H = 220, tex = 128, yaw = 325, pitch = 12 } = {}) {
  const groups = lib.assemble(parts);
  const texPix = {};
  for (const [id, spec] of Object.entries(textures || {})) texPix[id] = lib.paintSkin(spec, tex, true);
  const views = frames.map(t => {
    const def = groups.map(g => {
      const pos = new Array(g.pos.length), nrm = new Array(g.nrm.length);
      for (let i = 0; i < g.pos.length; i++) { const [p, n] = run(prog, g.pos[i], g.nrm[i] || [0, 1, 0], t); pos[i] = p; nrm[i] = n; }
      return { ...g, pos, nrm };
    });
    return renderView(def, texPix, W, H, yaw, pitch);
  });
  return toPNG(views, W, H);
}

export { renderView, toPNG, viewBasis, preview, lifePreview, project };
