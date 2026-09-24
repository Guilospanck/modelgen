// GLB JSON without the byte offsets/lengths of buffer views and buffers.
// Embedded PNG textures are deflate-compressed, and the compressed size depends
// on the runtime's zlib build (pixels do not), so those numbers shift between
// Bun versions. Everything else — nodes, meshes, materials, accessor counts and
// bounds, images — stays pinned.
export function stableGlbJson(doc: any): any {
  const copy = structuredClone(doc);
  for (const v of copy.bufferViews ?? []) { delete v.byteOffset; delete v.byteLength; }
  for (const b of copy.buffers ?? []) delete b.byteLength;
  return copy;
}
