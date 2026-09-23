import { inflateSync } from "node:zlib";

// Decodes the RGBA8 PNGs modelgen writes (filter type 0 on every row).
export function decodePng(b: Buffer): { width: number; height: number; pixels: Buffer } {
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8, width = 0, height = 0;
  const idat: Buffer[] = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off), type = b.toString("ascii", off + 4, off + 8);
    if (type === "IHDR") { width = b.readUInt32BE(off + 8); height = b.readUInt32BE(off + 12); }
    if (type === "IDAT") idat.push(b.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1, pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    if (raw[y * stride] !== 0) throw new Error(`row ${y}: unsupported PNG filter ${raw[y * stride]}`);
    raw.copy(pixels, y * width * 4, y * stride + 1, (y + 1) * stride);
  }
  return { width, height, pixels };
}
