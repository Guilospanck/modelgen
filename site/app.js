import { buildModel, editModel, parseModel, PATTERNS, VERSION } from "./modelgen.js";
import { createViewer, niceStep } from "./viewer.js";
import { renderTree, renderProperties, renderMaterials, h } from "./panels.js";
import { SHAPES, handlesFor, insidePoint, movePoint, round, uniqueName, allParts } from "./shapes.js";

const $ = id => document.getElementById(id);
const yaml = $("yaml"), status = $("status");

// The YAML text is the model. Every edit, from any panel or the viewport, produces new text;
// history is a list of texts.
const state = { text: "", doc: null, issues: [], selected: null, point: null, files: {}, name: "model", history: [], at: -1 };

const viewer = createViewer($("viewer"), {
  scale: step => { $("scale").textContent = `Grid squares: ${step}`; },
  select: (name, point = null) => select(name, point),
  transform: (name, t, mode) => {
    const set = {};
    if (mode === "translate") set.position = round(t.position);
    if (mode === "rotate") set.rotation = t.rotation.every(v => Math.abs(v) < 1e-6) ? null : round(t.rotation);
    if (mode === "scale") {
      const s = round(t.scale);
      set.scale = s.every(v => v === s[0]) ? (s[0] === 1 ? null : s[0]) : s;
    }
    edit([{ update: { name, set } }]);
  },
  point: (name, index, pos) => {
    const part = find(name)?.part;
    const handle = part && handlesFor(part)[index];
    if (handle) edit([{ update: { name, set: movePoint(part, handle.path, round(pos)) } }]);
  },
});

const examples = await (await fetch("examples.json")).json();
for (const e of examples) $("example").append(new Option(e.name, e.name));

// ---------- model text, history, edits ----------

const find = name => (state.doc && name ? allParts(state.doc.parts).find(x => x.part.name === name) : undefined);
const names = () => new Set(allParts(state.doc.parts).map(x => x.part.name));

function setText(text, { record = true, merge = false } = {}) {
  state.text = text;
  if (record) {
    state.history = state.history.slice(0, state.at + 1);
    if (merge && state.at >= 0) state.history[state.at] = text;
    else state.history.push(text);
    if (state.history.length > 200) state.history.shift();
    state.at = state.history.length - 1;
  }
  if (document.activeElement !== yaml) yaml.value = text;
  const parsed = parseModel(text);
  state.doc = parsed.doc ?? null;
  if (state.selected && !find(state.selected)) { state.selected = null; state.point = null; }
  rebuild(parsed);
}

// Applies modelgen edit ops; false (and a message) when modelgen refuses them.
function edit(ops) {
  if (!state.doc) { say("Fix the YAML problems first."); return false; }
  const r = editModel(state.text, ops);
  if (!r.text) { say(r.issues[0]?.message ?? "That edit didn't work."); return false; }
  setText(r.text);
  return true;
}

function undo(dir) {
  const at = state.at + dir;
  if (at < 0 || at >= state.history.length) return;
  state.at = at;
  setText(state.history[at], { record: false });
}

let sayTimer;
function say(message) {
  status.textContent = message;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { if (status.textContent === message) status.textContent = ""; }, 5000);
}

// ---------- build and render ----------

function rebuild(parsed) {
  const t0 = performance.now();
  let r;
  try { r = parsed.doc ? buildModel(state.text) : { files: [], issues: parsed.issues }; }
  catch (e) { r = { files: [], issues: [{ severity: "error", code: "internal", message: `modelgen crashed: ${e.message}`, hint: "this is a modelgen bug; please report it" }] }; }
  const ms = Math.round(performance.now() - t0);
  state.issues = r.issues;
  state.files = Object.fromEntries(r.files.map(f => [f.format, f.data]));
  state.name = r.name ?? state.name;
  for (const f of ["glb", "usdz"]) {
    $(f).disabled = !state.files[f];
    $(f).title = state.files[f] ? `${Math.round(state.files[f].length / 1024)} KB` : "Fix the problems listed in the sidebar to download";
  }
  $("stale").hidden = !!r.preview || !viewer.hasModel;
  if (r.preview) {
    const parts = allParts(state.doc.parts).map(x => x.part.name);
    const problems = r.issues.filter(i => i.severity === "error" && i.part).map(i => i.part);
    viewer.show(r.preview, r.name, { parts, problems }).then(syncViewer, e => say(`Preview failed: ${e.message}`));
  }
  status.textContent = r.files.length ? `Built ${r.name} in ${ms} ms` : "Can't download yet: see the problems in the sidebar";
  render();
}

function syncViewer() {
  const hit = find(state.selected);
  if (!hit) { viewer.select(null); return; }
  const points = handlesFor(hit.part);
  viewer.select({ name: hit.part.name, points, point: state.point !== null && state.point < points.length ? state.point : null });
}

function select(name, point = null) {
  state.selected = name;
  state.point = name ? point : null;
  syncViewer();
  render();
}

function render() {
  renderIssues();
  $("add").disabled = !state.doc;
  $("undo").disabled = state.at <= 0;
  $("redo").disabled = state.at >= state.history.length - 1;
  if (!state.doc) {
    const msg = () => h("p", { class: "empty" }, "The YAML has problems. Fix them in the YAML tab to keep editing.");
    $("tree").replaceChildren(msg());
    $("props").replaceChildren();
    $("materials").replaceChildren(msg());
    return;
  }
  const problems = new Set(state.issues.filter(i => i.part).map(i => i.part));
  const hit = find(state.selected);
  renderTree($("tree"), { doc: state.doc, selected: state.selected, problems, select, edit });
  renderProperties($("props"), {
    doc: state.doc, part: hit?.part, parent: hit?.parent, problems: state.issues, edit, select,
    newMaterial: partName => {
      const name = uniqueName("material", new Set(Object.keys(state.doc.materials ?? {})));
      edit([{ set_material: { name, material: { color: "#c8c2b4", roughness: 0.6 } } }, { update: { name: partName, set: { material: name } } }]);
    },
  });
  renderMaterials($("materials"), { doc: state.doc, edit, patterns: PATTERNS });
}

function renderIssues() {
  $("issues").replaceChildren(...state.issues.map(i => h("div", { class: `issue ${i.severity}` },
    h("p", {},
      i.part ? h("button", { type: "button", class: "link", onclick: () => { showTab("scene"); select(i.part); } }, i.part) : null,
      i.part ? ": " : null,
      i.message.replace(/^model\.yaml:?\s*/, "")),
    i.hint ? h("p", { class: "hint" }, i.hint) : null)));
}

// ---------- adding parts ----------

function addPart(shape) {
  const b = viewer.bounds();
  const size = b ? niceStep(Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 3) : 0.1;
  const target = find(state.selected);
  const parent = target?.part.group ? target.part.name : undefined;
  const name = uniqueName(shape, names());
  const part = { name, ...(shape === "group" ? { group: { parts: [] } } : { [shape]: round(SHAPES[shape].make(size)) }) };
  // New parts go where they touch the model (a floating part can't be exported): a point inside
  // the new shape lands on the model's surface, straight down through its middle.
  const at = !parent && viewer.surfacePoint();
  if (at && shape !== "group") { const inside = insidePoint(shape, size); part.position = round(at.map((v, i) => v - inside[i])); }
  if (edit([{ add: { ...(parent ? { parent } : {}), part } }])) select(name);
}

const menu = $("add-menu");
const closeMenu = () => { menu.hidden = true; $("add").setAttribute("aria-expanded", "false"); };
for (const [key, s] of [...Object.entries(SHAPES), ["group", { label: "Group" }]])
  menu.append(h("button", { type: "button", role: "menuitem", onclick: () => { closeMenu(); addPart(key); } }, s.label));
$("add").addEventListener("click", () => {
  menu.hidden = !menu.hidden;
  $("add").setAttribute("aria-expanded", String(!menu.hidden));
  if (!menu.hidden) menu.querySelector("button").focus();
});
document.addEventListener("click", e => { if (!e.target.closest(".menu")) closeMenu(); });
menu.addEventListener("keydown", e => {
  const items = [...menu.querySelectorAll("button")], i = items.indexOf(document.activeElement);
  if (e.key === "Escape") { closeMenu(); $("add").focus(); }
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
});

// ---------- tools, tabs, keys ----------

function setMode(mode) {
  viewer.setMode(mode);
  document.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
}
document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => setMode(b.dataset.mode)));
$("snap").addEventListener("change", e => viewer.setSnap(e.target.checked));

function showTab(name) {
  for (const t of ["scene", "materials", "yaml"]) {
    $(`tab-${t}`).setAttribute("aria-selected", String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
}
for (const t of ["scene", "materials", "yaml"]) $(`tab-${t}`).addEventListener("click", () => showTab(t));

function duplicateSelected() {
  const as = uniqueName(`${state.selected}-copy`, names());
  if (edit([{ duplicate: { name: state.selected, as } }])) select(as);
}

document.addEventListener("keydown", e => {
  if (e.target.closest?.("input, textarea, select")) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === "z") { e.preventDefault(); undo(e.shiftKey ? 1 : -1); return; }
  if (mod && k === "y") { e.preventDefault(); undo(1); return; }
  if (mod && k === "d" && state.selected) { e.preventDefault(); duplicateSelected(); return; }
  if (mod || e.altKey) return;
  if (k === "w") setMode("translate");
  if (k === "e") setMode("rotate");
  if (k === "r") setMode("scale");
  if (k === "f") viewer.focus();
  if (k === "escape") select(state.point !== null ? state.selected : null);
  if ((k === "delete" || k === "backspace") && state.selected && state.point === null) {
    e.preventDefault();
    if (edit([{ remove: { name: state.selected } }])) select(null);
  }
});

// ---------- YAML tab, examples, downloads, sharing ----------

let typing, lastTyped = 0;
yaml.addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(() => {
    // A burst of typing is one undo step.
    const merge = performance.now() - lastTyped < 1500;
    lastTyped = performance.now();
    setText(yaml.value, { merge });
  }, 300);
});
yaml.addEventListener("keydown", e => {
  if (e.key !== "Tab" || e.shiftKey) return;
  e.preventDefault();
  yaml.setRangeText("  ", yaml.selectionStart, yaml.selectionEnd, "end");
  yaml.dispatchEvent(new Event("input"));
});

// A shared link carries the model in the URL hash.
const encode = s => btoa(Array.from(new TextEncoder().encode(s), b => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));

$("example").addEventListener("change", e => {
  const example = examples.find(x => x.name === e.target.value);
  if (!example) return;
  history.replaceState(null, "", location.pathname);
  state.selected = null;
  setText(example.text);
});
function download(format) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([state.files[format]]));
  a.download = `${state.name}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("glb").addEventListener("click", () => download("glb"));
$("usdz").addEventListener("click", () => download("usdz"));
$("undo").addEventListener("click", () => undo(-1));
$("redo").addEventListener("click", () => undo(1));
$("share").addEventListener("click", async () => {
  history.replaceState(null, "", `#${encode(state.text)}`);
  try { await navigator.clipboard.writeText(location.href); say("Link copied"); }
  catch { say("The link is in the address bar"); }
});
document.querySelector("h1").title = `modelgen ${VERSION}`;

let initial = examples.find(e => e.name === "lantern") ?? examples[0];
if (location.hash.length > 1) {
  try {
    initial = { name: "shared", text: decode(location.hash.slice(1)) };
    $("example").prepend(new Option("Shared link", "shared"));
  } catch { /* bad link: fall back to the example */ }
}
$("example").value = initial.name;
setText(initial.text);
