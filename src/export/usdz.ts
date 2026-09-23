import { usda, usdz } from "../engine/lib";
import type { Group, Skin } from "../engine/types";

// USD zip: model.usda first, then textures/<id>.png and textures/<id>_n.png per skin used.
export function writeUsdz(groups: Group[], skins: Record<string, Skin>): Buffer {
  const entries: { name: string; data: Buffer }[] = [{ name: "model.usda", data: Buffer.from(usda(groups), "utf8") }];
  for (const [id, t] of Object.entries(skins)) {
    entries.push({ name: `textures/${id}.png`, data: t.diffuse });
    entries.push({ name: `textures/${id}_n.png`, data: t.normal });
  }
  return usdz(entries);
}

// Stored zip, every entry 64-byte aligned, usda first, png payloads real PNGs.
export function validateUsdz(b: Buffer, expectedEntries?: number): string[] {
  let off = 0, entries = 0, aligned = true;
  const issues: string[] = [];
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
  if (b.length < 22 || b.readUInt32LE(b.length - 22) !== 0x06054b50) issues.push("no end-of-central-directory record");
  if (!aligned) issues.push("entries not 64-byte aligned");
  if (expectedEntries !== undefined && entries !== expectedEntries) issues.push(`${entries} entries, expected ${expectedEntries}`);
  return issues;
}

// Text of the first entry (model.usda).
export function readUsda(b: Buffer): string {
  const nameLen = b.readUInt16LE(26), extraLen = b.readUInt16LE(28), size = b.readUInt32LE(18);
  const start = 30 + nameLen + extraLen;
  return b.toString("utf8", start, start + size);
}

export function parseUsdaPoints(text: string): number[][] {
  const pts: number[][] = [];
  const re = /point3f\[\] points = \[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    for (const n of m[1].match(/\(([^()]+)\)/g) || []) pts.push(n.slice(1, -1).split(",").map(Number));
  }
  return pts;
}
