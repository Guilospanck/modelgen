// Sidebar panels: the scene tree, the selected part's properties and the materials list.
// Every change goes out as modelgen edit ops through `edit(ops)`; panels never touch the YAML.
import { SHAPES, BLOB_SHAPES, shapeOf, round, uniqueName } from "./shapes.js";

const piece = type => round(BLOB_SHAPES[type].make(0.1));

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "value" || (k in el && typeof v !== "string")) el[k] = v; // a textarea's value is a property only
    else el.setAttribute(k, v === true ? "" : v);
  }
  el.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
  return el;
}

const DEG = 180 / Math.PI;
const num = v => (v === undefined || v === null || v === "" ? undefined : Number(v));

// A number input that commits on change (Enter or leaving the field), not on every keystroke.
function numberInput(value, commit, { step = "any", min, label, placeholder, path } = {}) {
  return h("input", {
    type: "number", step, min, value: value ?? "", placeholder, "aria-label": label, dataset: path ? { path } : undefined,
    onchange: e => { const v = num(e.target.value); if (v === undefined || Number.isFinite(v)) commit(v); },
  });
}
function vecInputs(values, commit, { labels = ["x", "y", "z"], path, ...opts } = {}) {
  return h("div", { class: "vec" }, values.map((v, i) => numberInput(v, n => {
    if (n === undefined) return;
    const next = values.slice(); next[i] = n; commit(next);
  }, { ...opts, label: labels[i], path: path && `${path}.${i}` })));
}

function row(label, control, extra) {
  return h("div", { class: "row" }, h("span", { class: "label" }, label), control, extra);
}

// ---------- scene tree ----------

export function renderTree(root, { doc, selected, problems, select, edit }) {
  const drop = (target, e) => {
    e.preventDefault();
    root.querySelectorAll(".drop").forEach(n => n.classList.remove("drop"));
    const name = e.dataTransfer.getData("text/x-part");
    if (!name || name === target) return;
    edit([{ reparent: { name, parent: target } }]);
  };
  const item = (p, depth) => {
    const isGroup = !!p.group, hidden = p.visible === false;
    const el = h("div", {
      class: `node${p.name === selected ? " on" : ""}${hidden ? " hidden" : ""}`, role: "treeitem", tabIndex: 0,
      "aria-selected": String(p.name === selected), draggable: true, style: `--depth: ${depth}`,
      onclick: () => select(p.name),
      onkeydown: e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(p.name); } },
      ondragstart: e => { e.dataTransfer.setData("text/x-part", p.name); e.dataTransfer.effectAllowed = "move"; },
      ondragover: e => { if (isGroup) { e.preventDefault(); el.classList.add("drop"); } },
      ondragleave: () => el.classList.remove("drop"),
      ondrop: e => { if (isGroup) { e.stopPropagation(); drop(p.name, e); } },
    },
      h("span", { class: "kind" }, isGroup ? "Group" : SHAPES[shapeOf(p)]?.label ?? shapeOf(p)),
      h("span", { class: "name" }, p.name),
      problems.has(p.name) ? h("span", { class: "problem", title: "This part has a problem" }, "!") : null,
      h("button", {
        class: "eye", type: "button", title: hidden ? "Show" : "Hide", "aria-label": `${hidden ? "Show" : "Hide"} ${p.name}`,
        onclick: e => { e.stopPropagation(); edit([{ update: { name: p.name, set: { visible: hidden ? null : false } } }]); },
      }, hidden ? "Show" : "Hide"),
    );
    return [el, ...(p.group?.parts ?? []).flatMap(c => item(c, depth + 1))];
  };
  root.replaceChildren(...doc.parts.flatMap(p => item(p, 0)));
  if (!doc.parts.length) root.append(h("p", { class: "empty" }, "No parts yet. Use Add to place the first one."));
  // Dropping on empty space moves a part to the top level.
  root.ondragover = e => e.preventDefault();
  root.ondrop = e => drop(null, e);
}

// ---------- properties ----------

function fieldControl(kind, value, commit, path) {
  if (kind === "num" || kind === "int") return numberInput(value, commit, { step: kind === "int" ? 1 : "any", path });
  if (kind === "string") return h("textarea", { class: "field", rows: 2, value: value ?? "", dataset: { path }, onchange: e => e.target.value && commit(e.target.value) });
  if (kind.startsWith("enum:")) return h("select", { dataset: { path }, onchange: e => commit(e.target.value || undefined) },
    h("option", { value: "" }, "default"), kind.slice(5).split("|").map(o => h("option", { value: o, selected: o === value }, o)));
  if (kind === "vec3") return vecInputs(value, commit, { path });
  if (kind === "vec2") return vecInputs(value, commit, { labels: ["x", "y"], path });
  if (kind === "radius2") {
    const pair = Array.isArray(value) ? value : [value, value];
    return h("div", { class: "vec" },
      numberInput(pair[0], v => v !== undefined && commit(pair[1] === v ? v : [v, pair[1]]), { label: "top", path: `${path}.0` }),
      numberInput(pair[1], v => v !== undefined && commit(pair[0] === v ? v : [pair[0], v]), { label: "bottom", path: `${path}.1` }));
  }
  if (kind === "points2" || kind === "points3" || kind === "nums") {
    const list = value ?? [];
    const width = kind === "points2" ? 2 : 3;
    const rows = list.map((p, i) => h("div", { class: "point" },
      h("span", { class: "index" }, String(i + 1)),
      kind === "nums"
        ? numberInput(p, v => { if (v === undefined) return; const n = list.slice(); n[i] = v; commit(n); }, { label: `point ${i + 1}`, path: `${path}.${i}` })
        : vecInputs(p, v => { const n = list.slice(); n[i] = v; commit(n); }, { labels: width === 2 ? ["x", "y"] : ["x", "y", "z"], path: `${path}.${i}` }),
      h("button", { type: "button", class: "icon", title: "Remove point", "aria-label": `Remove point ${i + 1}`, onclick: () => commit(list.filter((_, j) => j !== i)) }, "×"),
    ));
    // A new point goes halfway between the last two, so the shape doesn't jump.
    const add = () => {
      if (kind === "nums") return commit([...list, list.at(-1) ?? 0.01]);
      const a = list.at(-2) ?? list.at(-1) ?? Array(width).fill(0), b = list.at(-1) ?? a;
      commit([...list.slice(0, -1), round(a.map((v, k) => (v + b[k]) / 2)), b].slice(list.length ? 0 : 1));
    };
    return h("div", { class: "points" }, rows, h("button", { type: "button", class: "small", onclick: add }, "Add point"));
  }
  if (kind === "blob") {
    return h("div", { class: "blob" }, value.map((b, k) => {
      const [type] = Object.keys(b), spec = BLOB_SHAPES[type];
      const set = v => { const n = structuredClone(value); n[k] = v; commit(n); };
      return h("fieldset", {},
        h("legend", {}, h("select", {
          "aria-label": "Blob piece type",
          onchange: e => set({ [e.target.value]: piece(e.target.value) }),
        }, Object.keys(BLOB_SHAPES).map(t => h("option", { value: t, selected: t === type }, t))),
          h("button", { type: "button", class: "icon", title: "Remove piece", "aria-label": "Remove piece", disabled: value.length === 1, onclick: () => commit(value.filter((_, j) => j !== k)) }, "×")),
        spec.fields.map(([key, fk, optional]) => row(key, fieldControl(fk, b[type][key], v => {
          const inner = { ...b[type] };
          if (v === undefined && optional) delete inner[key]; else if (v !== undefined) inner[key] = v; else return;
          set({ [type]: inner });
        }, `${path}.${k}.${key}`))),
      );
    }), h("button", { type: "button", class: "small", onclick: () => commit([...value, { sphere: piece("sphere") }]) }, "Add piece"));
  }
  return h("code", {}, JSON.stringify(value));
}

export function renderProperties(root, { doc, part, parent, problems, edit, select, newMaterial, fixable, fix, renameModel }) {
  // Nothing selected: the model itself.
  if (!part) {
    const count = doc.parts.length;
    keepFocus(root, () => root.replaceChildren(
      h("h3", {}, "Model"),
      h("div", { class: "row" }, h("label", { class: "label", for: "model-name-input" }, "Name"),
        h("input", { id: "model-name-input", value: doc.name, dataset: { path: "model.name" }, onchange: e => { const n = e.target.value.trim(); if (n && n !== doc.name) renameModel(n); } })),
      h("p", { class: "note" }, "Lowercase letters, digits, _ and -. Downloads are named after it."),
      h("p", { class: "empty" }, count ? "Select a part in the viewport or the list to edit it." : "Use Add to place the first part.")));
    return;
  }
  const name = part.name, shape = shapeOf(part);
  const update = set => edit([{ update: { name, set } }]);
  // Degrees to 2 decimals: 1.5708 rad reads as 90°, not 90.0002°.
  const rot = (part.rotation ?? [0, 0, 0]).map(r => Math.round(r * DEG * 100) / 100 + 0);
  const scale = part.scale === undefined ? [1, 1, 1] : typeof part.scale === "number" ? [part.scale, part.scale, part.scale] : part.scale;
  const materials = Object.keys(doc.materials ?? {});

  const sections = [
    h("div", { class: "row" }, h("label", { class: "label", for: "prop-name" }, "Name"),
      h("input", {
        id: "prop-name", value: name, dataset: { path: "name" },
        onchange: e => { const to = e.target.value.trim(); if (to && to !== name && edit([{ rename: { name, to } }])) select(to); },
      })),
    row("Shape", h("span", { class: "value" }, shape === "group" ? `Group of ${part.group.parts.length}` : SHAPES[shape]?.label ?? shape)),
    parent ? row("In group", h("span", { class: "value" }, parent)) : null,
    h("h3", {}, "Transform"),
    row("Position", vecInputs(part.position ?? [0, 0, 0], v => update({ position: round(v) }), { path: "position" }), h("span", { class: "unit" }, "m")),
    row("Rotation", vecInputs(rot, v => update({ rotation: v.every(x => x === 0) ? null : round(v.map(x => x / DEG)) }), { path: "rotation" }), h("span", { class: "unit" }, "°")),
    row("Scale", vecInputs(scale, v => update({ scale: v.every(x => x === v[0]) ? (v[0] === 1 ? null : v[0]) : v }), { path: "scale" })),
  ];

  if (SHAPES[shape]) {
    sections.push(h("h3", {}, SHAPES[shape].label));
    for (const [key, kind, optional] of SHAPES[shape].fields) {
      const value = part[shape][key];
      sections.push(row(key, fieldControl(kind, value, v => {
        if (v === undefined && !optional) return;
        const next = { ...part[shape] };
        if (v === undefined || (Array.isArray(v) && !v.length && optional)) delete next[key]; else next[key] = v;
        update({ [shape]: next });
      }, `${shape}.${key}`), optional && value === undefined ? h("span", { class: "unit" }, "default") : null));
    }
  }
  if (shape === "script") sections.push(h("p", { class: "note" }, "Script parts run in the modelgen CLI only; the browser shows everything else."));

  if (shape !== "group") {
    sections.push(h("h3", {}, "Look"),
      row("Material", h("select", {
        "aria-label": "Material", dataset: { path: "material" },
        onchange: e => {
          if (e.target.value === "+new") newMaterial(name);
          else update({ material: e.target.value || null });
        },
      }, h("option", { value: "" }, "None"), materials.map(m => h("option", { value: m, selected: m === part.material }, m)), h("option", { value: "+new" }, "New material…"))),
      row("Bump", numberInput(part.bump, v => update({ bump: v ?? null }), { min: 0, placeholder: "none", path: "bump" })));
  }
  sections.push(row("Visible", h("input", { type: "checkbox", checked: part.visible !== false, onchange: e => update({ visible: e.target.checked ? null : false }) })));

  const problemsHere = problems.filter(i => i.part === name);
  if (problemsHere.length) sections.unshift(h("div", { class: "issue error" },
    problemsHere.map(i => h("p", {}, i.message)),
    problemsHere[0].hint ? h("p", { class: "hint" }, problemsHere[0].hint) : null,
    problemsHere.some(fixable) ? h("button", { type: "button", class: "small primary", onclick: () => fix(problemsHere.filter(fixable)) }, "Fix") : null));

  const taken = new Set(), walk = ps => ps.forEach(p => { taken.add(p.name); if (p.group) walk(p.group.parts); });
  walk(doc.parts);
  sections.push(h("div", { class: "actions-row" },
    h("button", { type: "button", onclick: () => { const as = uniqueName(`${name}-copy`, taken); if (edit([{ duplicate: { name, as } }])) select(as); } }, "Duplicate"),
    h("button", { type: "button", class: "danger", onclick: () => { if (edit([{ remove: { name } }])) select(null); } }, "Delete")));
  keepFocus(root, () => root.replaceChildren(...sections.filter(Boolean)));
}

// ---------- materials ----------

export function renderMaterials(root, { doc, edit, say, patterns }) {
  const mats = doc.materials ?? {};
  const users = {}, walk = ps => ps.forEach(p => { if (p.material) (users[p.material] ??= []).push(p.name); if (p.group) walk(p.group.parts); });
  walk(doc.parts);

  const card = (name, m) => {
    const set = patch => {
      const next = { ...m, ...patch };
      for (const [k, v] of Object.entries(next)) if (v === undefined || v === null) delete next[k];
      edit([{ set_material: { name, material: next } }]);
    };
    const slider = (key, label, min, fallback) => row(label, h("div", { class: "slider" },
      h("input", { type: "range", min, max: 1, step: 0.01, value: m[key] ?? fallback, "aria-label": label, onchange: e => set({ [key]: Number(e.target.value) }) }),
      numberInput(m[key], v => set({ [key]: v }), { min, placeholder: String(fallback), label, path: `mat.${name}.${key}` })));
    const tex = m.texture;
    const setTex = patch => set({ texture: { ...tex, ...patch } });
    const rename = to => {
      if (!to || to === name || mats[to]) return;
      edit([{ set_material: { name: to, material: m } }, ...(users[name] ?? []).map(p => ({ update: { name: p, set: { material: to } } })), { remove_material: { name } }]);
    };
    return h("section", { class: "material" },
      h("div", { class: "material-head" },
        h("input", { type: "color", value: m.color, "aria-label": `${name} color`, onchange: e => set({ color: e.target.value }) }),
        h("input", { class: "material-name", value: name, "aria-label": "Material name", dataset: { path: `mat.${name}` }, onchange: e => rename(e.target.value.trim()) }),
        h("span", { class: "users" }, users[name] ? `${users[name].length} part${users[name].length > 1 ? "s" : ""}` : "unused"),
        // Deleting a material in use leaves its parts plain; one undo brings it all back.
        h("button", {
          type: "button", class: "icon", title: "Delete material", "aria-label": `Delete ${name}`,
          onclick: () => {
            const parts = users[name] ?? [];
            if (edit([...parts.map(p => ({ update: { name: p, set: { material: null } } })), { remove_material: { name } }]) && parts.length)
              say(`Deleted "${name}"; ${parts.length === 1 ? "1 part has" : `${parts.length} parts have`} no material now. Undo brings it back.`);
          },
        }, "×")),
      slider("roughness", "Roughness", 0, 0.5),
      slider("metalness", "Metalness", 0, 0),
      slider("opacity", "Opacity", 0.01, 1),
      row("Glow", h("div", { class: "inline" },
        h("input", { type: "checkbox", checked: !!m.emissive, "aria-label": "Glow", onchange: e => set({ emissive: e.target.checked ? m.color : null }) }),
        m.emissive ? h("input", { type: "color", value: m.emissive, "aria-label": "Glow color", onchange: e => set({ emissive: e.target.value }) }) : null)),
      row("Texture", h("select", {
        "aria-label": "Texture pattern", onchange: e => set({ texture: e.target.value ? { ...tex, pattern: e.target.value } : null }),
      }, h("option", { value: "" }, "None"), patterns.map(p => h("option", { value: p, selected: tex?.pattern === p }, p)))),
      tex ? [
        row("Pattern color", h("input", { type: "color", value: tex.color ?? "#000000", "aria-label": "Pattern color", onchange: e => setTex({ color: e.target.value }) })),
        row("Pattern scale", numberInput(tex.scale, v => setTex({ scale: v }), { min: 0, placeholder: "1", path: `mat.${name}.tex.scale` })),
        row("Seed", numberInput(tex.seed, v => setTex({ seed: v }), { step: 1, placeholder: "0", path: `mat.${name}.tex.seed` })),
      ] : null,
    );
  };

  keepFocus(root, () => root.replaceChildren(
    ...Object.entries(mats).map(([n, m]) => card(n, m)),
    h("button", { type: "button", class: "small", onclick: () => edit([{ set_material: { name: uniqueName("material", new Set(Object.keys(mats))), material: { color: "#c8c2b4", roughness: 0.6 } } }]) }, "Add material"),
  ));
}

// Re-rendering replaces the inputs; put the cursor back in the field that had it.
function keepFocus(root, render) {
  const path = root.contains(document.activeElement) ? document.activeElement.dataset.path : undefined;
  const top = root.scrollTop;
  render();
  root.scrollTop = top;
  if (path) root.querySelector(`[data-path="${CSS.escape(path)}"]`)?.focus();
}
