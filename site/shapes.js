// What each shape looks like to the editor: its form fields, a sensible new part of a given size,
// and which of its points can be dragged in the viewport.

// Field kinds: num, int (optional segments etc.), vec2, vec3, radius2 (number or [top, bottom]),
// points2 / points3 (profiles and paths), nums (one number per point), blob (list of blob shapes),
// string (multi-line text), enum:a|b|c (one of the listed words).
export const SHAPES = {
  box: { label: "Box", fields: [["size", "vec3"]], make: s => ({ size: [s, s, s] }) },
  sphere: { label: "Sphere", fields: [["radius", "num"], ["segments", "int", true]], make: s => ({ radius: s / 2 }) },
  cylinder: { label: "Cylinder", fields: [["radius", "radius2"], ["height", "num"], ["segments", "int", true]], make: s => ({ radius: s / 2, height: s }) },
  cone: { label: "Cone", fields: [["radius", "num"], ["height", "num"], ["segments", "int", true]], make: s => ({ radius: s / 2, height: s }) },
  capsule: { label: "Capsule", fields: [["radius", "num"], ["length", "num"], ["segments", "int", true]], make: s => ({ radius: s / 4, length: s / 2 }) },
  torus: { label: "Torus", fields: [["radius", "num"], ["tube", "num"], ["segments", "int", true]], make: s => ({ radius: s / 2, tube: s / 8 }), inside: s => [s / 2, 0, 0] },
  plane: { label: "Plane", fields: [["size", "vec2"]], make: s => ({ size: [s, s] }) },
  extrude: {
    label: "Extrude", fields: [["profile", "points2"], ["depth", "num"]],
    make: s => ({ profile: [[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [0, s * 0.8], [-s / 2, s / 2]], depth: s / 4 }),
  },
  lathe: {
    label: "Lathe", fields: [["profile", "points2"], ["segments", "int", true]],
    make: s => ({ profile: [[0, 0], [s * 0.4, 0], [s * 0.5, s * 0.5], [s * 0.3, s], [0, s]] }), inside: s => [0, s / 2, 0],
  },
  tube: {
    label: "Tube", fields: [["path", "points3"], ["radius", "num", true], ["radii", "nums", true], ["segments", "int", true], ["boxiness", "num", true]],
    make: s => ({ path: [[-s / 2, 0, 0], [0, s / 2, 0], [s / 2, 0, 0]], radius: s / 12 }), inside: s => [0, s / 2, 0],
  },
  blob: {
    label: "Blob", fields: [["shapes", "blob"], ["blend", "num", true], ["resolution", "int", true]],
    make: s => ({ shapes: [{ sphere: { center: [0, 0, 0], radius: s / 2 } }, { sphere: { center: [s / 2, s / 3, 0], radius: s / 3 } }] }),
  },
  text: {
    label: "Text",
    fields: [["string", "string"], ["size", "num"], ["depth", "num"], ["align", "enum:left|center|right", true], ["spacing", "num", true], ["lineHeight", "num", true], ["segments", "int", true]],
    make: s => ({ string: "Text", size: s / 2, depth: s / 10, align: "center" }),
  },
};

export const BLOB_SHAPES = {
  sphere: { fields: [["center", "vec3"], ["radius", "num"]], make: s => ({ center: [0, 0, 0], radius: s / 3 }) },
  ellipsoid: { fields: [["center", "vec3"], ["radii", "vec3"]], make: s => ({ center: [0, 0, 0], radii: [s / 2, s / 3, s / 3] }) },
  capsule: { fields: [["from", "vec3"], ["to", "vec3"], ["radius", "num"], ["radiusEnd", "num", true]], make: s => ({ from: [0, 0, 0], to: [0, s, 0], radius: s / 5 }) },
  chain: { fields: [["points", "points3"], ["radii", "nums"]], make: s => ({ points: [[0, 0, 0], [0, s / 2, 0], [s / 4, s, 0]], radii: [s / 4, s / 5, s / 8] }) },
};

// A point inside a new part (in its own space), for placing it so it touches the model.
export const insidePoint = (shape, s) => SHAPES[shape]?.inside?.(s) ?? [0, 0, 0];

export const shapeOf = part => Object.keys(SHAPES).find(k => part[k] !== undefined) ?? (part.group ? "group" : part.script ? "script" : undefined);

// Draggable points in the part's own space. `path` says where the point lives in the part;
// `flat` points (profiles) move in the xy plane only.
export function handlesFor(part) {
  const shape = shapeOf(part), spec = part[shape], out = [];
  if (shape === "lathe") spec.profile.forEach(([r, y], i) => out.push({ path: ["profile", i], pos: [r, y, 0], flat: true }));
  if (shape === "extrude") spec.profile.forEach(([x, y], i) => out.push({ path: ["profile", i], pos: [x, y, spec.depth / 2], flat: true }));
  if (shape === "tube") spec.path.forEach((p, i) => out.push({ path: ["path", i], pos: p }));
  if (shape === "blob") spec.shapes.forEach((b, k) => {
    const [type] = Object.keys(b), v = b[type];
    if (type === "sphere" || type === "ellipsoid") out.push({ path: ["shapes", k, type, "center"], pos: v.center });
    if (type === "capsule") out.push({ path: ["shapes", k, type, "from"], pos: v.from }, { path: ["shapes", k, type, "to"], pos: v.to });
    if (type === "chain") v.points.forEach((p, i) => out.push({ path: ["shapes", k, type, "points", i], pos: p }));
  });
  return out;
}

// The shape object with the point at `path` moved to `pos` (in the part's space).
export function movePoint(part, path, pos) {
  const shape = shapeOf(part), spec = structuredClone(part[shape]);
  let at = spec;
  for (const k of path.slice(0, -1)) at = at[k];
  const last = path.at(-1);
  at[last] = at[last].length === 2 ? [pos[0], pos[1]] : pos; // profiles keep their 2D points
  return { [shape]: spec };
}

// Rounded to 0.1 mm / 0.0001 rad, which keeps the YAML readable; never "-0". Works through nested shapes.
export const round = v =>
  Array.isArray(v) ? v.map(round)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]))
  : typeof v === "number" ? Math.round(v * 1e4) / 1e4 + 0
  : v;

export function uniqueName(base, taken) {
  for (let i = 1; ; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`;
}

export function allParts(parts, parent = null, out = []) {
  for (const p of parts) {
    out.push({ part: p, parent });
    if (p.group) allParts(p.group.parts, p.name, out);
  }
  return out;
}
