import { buildModel, defineMaterials, editModel, parseModel, renameModel, PATTERNS, VERSION } from "./modelgen.js";
import { createViewer, niceStep } from "./viewer.js";
import { renderTree, renderProperties, renderMaterials, h } from "./panels.js";
import { SHAPES, handlesFor, insidePoint, movePoint, restHeight, round, uniqueName, allParts } from "./shapes.js";
import { createAssistant } from "./assistant.js";
import { listModels, loadModel, saveModel, deleteModel } from "./store.js";

const $ = id => document.getElementById(id);
const yaml = $("yaml"), status = $("status");

// The YAML text is the model. Every edit, from any panel or the viewport, produces new text;
// history is a list of texts. source says where the open model came from (an example, a new
// canvas, a shared link, or a model saved in this browser, with its id); savedText is the text
// as last opened or saved, so a change since then is still to be saved.
const state = {
  text: "", doc: null, issues: [], selected: null, point: null, files: {}, name: "model", history: [], at: -1,
  source: { kind: "example", id: null }, savedText: "",
};

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
  scheduleSave();
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
  // A model without parts is an empty canvas, not a problem.
  const empty = !!state.doc && state.doc.parts.length === 0;
  $("empty-canvas").hidden = !empty;
  if (empty) viewer.clear();
  $("stale").hidden = empty || !!r.preview || !viewer.hasModel;
  if (r.preview) {
    const parts = allParts(state.doc.parts).map(x => x.part.name);
    const problems = r.issues.filter(i => i.severity === "error" && i.part).map(i => i.part);
    viewer.show(r.preview, r.name, { parts, problems }).then(syncViewer, e => say(`Preview failed: ${e.message}`));
  }
  status.textContent = empty ? "Empty canvas" : r.files.length ? `Built ${r.name} in ${ms} ms` : "Can't download yet: see the problems in the sidebar";
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
  const name = state.doc?.name ?? state.name;
  $("model-name").textContent = name;
  document.title = `${name} – modelgen playground`;
  renderSaveState();
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
    doc: state.doc, part: hit?.part, parent: hit?.parent, problems: state.issues, edit, select, fixable, fix, renameModel: renameCurrentModel,
    newMaterial: partName => {
      const name = uniqueName("material", new Set(Object.keys(state.doc.materials ?? {})));
      edit([{ set_material: { name, material: { color: "#c8c2b4", roughness: 0.6 } } }, { update: { name: partName, set: { material: name } } }]);
    },
  });
  renderMaterials($("materials"), { doc: state.doc, edit, say, patterns: PATTERNS });
}

// ---------- quick fixes ----------

// The problems with an obvious fix: a floating part (move it to touch the model) and a material
// used but never defined (define it). The rest need a person to decide.
const missingMaterial = i => (i.code === "invalid" && i.message.match(/unknown material "(.+)"$/)?.[1]) || null;
const fixable = i => (i.code === "floating" && !!i.part) || !!missingMaterial(i);

function fix(issues) {
  const materials = [...new Set(issues.map(missingMaterial).filter(Boolean))];
  if (materials.length) {
    setText(defineMaterials(state.text, materials));
    say(`Defined ${materials.map(m => `"${m}"`).join(", ")}. Pick its color in Materials.`);
    return;
  }
  const floating = issues.filter(i => i.code === "floating").map(i => i.part);
  const moves = viewer.touchFix(floating);
  const ops = Object.entries(moves).map(([name, position]) => ({ update: { name, set: { position: round(position) } } }));
  if (ops.length && edit(ops)) say(ops.length === 1 ? `Moved "${ops[0].update.name}" to touch the model.` : `Moved ${ops.length} parts to touch the model.`);
  else if (!ops.length) say("Couldn't work out where to move it; drag it onto the model instead.");
}

function renderIssues() {
  const shown = state.doc?.parts.length === 0 ? state.issues.filter(i => i.code !== "empty") : state.issues;
  const fixes = shown.filter(fixable);
  $("issues").replaceChildren(...[
    fixes.length > 1 ? h("div", { class: "issues-head" }, h("span", {}, `${shown.length} problems`), h("button", { type: "button", class: "small primary", onclick: () => fix(fixes) }, "Fix all")) : null,
    ...shown.map(i => h("div", { class: `issue ${i.severity}` },
      h("p", {},
        i.part ? h("button", { type: "button", class: "link", onclick: () => { showTab("scene"); select(i.part); } }, i.part) : null,
        i.part ? ": " : null,
        i.message.replace(/^model\.yaml:?\s*/, "")),
      i.hint ? h("p", { class: "hint" }, i.hint) : null,
      fixable(i) ? h("button", { type: "button", class: "small primary", onclick: () => fix([i]) }, "Fix") : null)),
  ].filter(Boolean));
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
  // The first part of an empty canvas stands on the floor.
  else if (!state.doc.parts.length && shape !== "group") part.position = [0, round(restHeight(shape, size)), 0];
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

// The Ask tab's model answers with edit ops; they go through the same path as every other edit.
createAssistant($("ask"), {
  state: () => ({ text: state.text, doc: state.doc, issues: state.issues }),
  apply: ops => {
    const r = editModel(state.text, ops);
    if (!r.text) return { error: r.issues.map(i => i.message).join("; ") || "modelgen refused the ops" };
    setText(r.text);
    return { changes: r.changes };
  },
  say,
});

function showTab(name) {
  for (const t of ["scene", "ask", "materials", "yaml"]) {
    $(`tab-${t}`).setAttribute("aria-selected", String(t === name));
    $(`panel-${t}`).hidden = t !== name;
  }
}
for (const t of ["scene", "ask", "materials", "yaml"]) $(`tab-${t}`).addEventListener("click", () => showTab(t));

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

// ---------- opening and saving models ----------

// Every change saves itself a moment after the last one. An example, a new canvas or a shared
// link is saved as a copy on its first change, so the examples themselves never change.
const SAVE_DELAY = 600;
let saveTimer = null, saving = Promise.resolve(), saveError = null;
const remember = id => { try { if (id) localStorage.setItem("modelgen.last", id); else localStorage.removeItem("modelgen.last"); } catch { /* fine */ } };

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = state.text === state.savedText ? null : setTimeout(flush, SAVE_DELAY);
  renderSaveState();
}

// Saves now; saves run one after another, so a slow one never lands after a newer one.
function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  saving = saving.then(async () => {
    const text = state.text;
    if (text === state.savedText) return;
    try {
      const saved = await saveModel({ id: state.source.kind === "saved" ? state.source.id : undefined, name: state.doc?.name ?? state.name, text });
      state.source = { kind: "saved", id: saved.id };
      state.savedText = text;
      saveError = null;
      remember(saved.id);
    } catch (e) {
      saveError = e.message;
    }
    renderSaveState();
  });
  return saving;
}

function renderSaveState() {
  const el = $("save-state"), pending = saveTimer !== null || state.text !== state.savedText;
  const [label, title, kind] =
    saveError ? ["Not saved", `Couldn't save: ${saveError}`, "bad"]
    : pending ? ["Saving…", "Changes save in this browser as you go", ""]
    : state.source.kind === "saved" ? ["Saved", "Saved in this browser; changes save as you go", "ok"]
    : ["Edits save a copy", "The first change saves a copy of this model in this browser", ""];
  el.textContent = label;
  el.title = title;
  el.className = `save-state ${kind}`;
}

// A new canvas gets a name to go by until you pick one.
const ADJECTIVES = ["amber", "brave", "calm", "cosmic", "dusty", "eager", "fuzzy", "gentle", "hollow", "jolly", "lucky", "misty", "nimble", "quiet", "rusty", "silver", "tiny", "velvet", "witty", "zesty"];
const NOUNS = ["acorn", "anchor", "beacon", "cactus", "comet", "falcon", "harbor", "kettle", "lantern", "maple", "mitten", "nugget", "otter", "pebble", "pickle", "robot", "rocket", "teapot", "turnip", "walrus"];
const pick = list => list[Math.floor(Math.random() * list.length)];
const newModelText = () => `modelgen: 1\nname: ${pick(ADJECTIVES)}-${pick(NOUNS)}\nparts: []\n`;

// Opens a model with a fresh undo history; the one being left is saved first.
async function openModel(text, source) {
  await flush();
  history.replaceState(null, "", location.pathname);
  state.selected = null;
  state.point = null;
  state.source = source;
  state.savedText = text;
  state.history = [];
  state.at = -1;
  saveError = null;
  remember(source.kind === "saved" ? source.id : null);
  setText(text);
  return true;
}

const modelsMenu = $("models-menu");
function closeModels() { modelsMenu.hidden = true; $("models").setAttribute("aria-expanded", "false"); }
async function fillModelsMenu() {
  let saved = [];
  try { saved = await listModels(); } catch { /* storage off: no saved section */ }
  const when = t => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const item = (label, onclick, extra) => h("button", { type: "button", role: "menuitem", onclick: async () => { closeModels(); await onclick(); } }, label, extra);
  const row = m => {
    const del = h("button", {
      type: "button", class: "icon", title: "Delete", "aria-label": `Delete ${m.name}`,
      // Two clicks: the first arms it, so a stray click can't delete a model.
      onclick: async e => {
        e.stopPropagation();
        if (!del.classList.contains("armed")) { del.classList.add("armed"); del.textContent = "Delete?"; return; }
        await flush();
        await deleteModel(m.id);
        // The open model stays open, unsaved; its next change saves it again as a new copy.
        if (state.source.kind === "saved" && state.source.id === m.id) { state.source = { kind: "new", id: null }; remember(null); renderSaveState(); }
        say(`Deleted "${m.name}"`);
        fillModelsMenu();
      },
    }, "×");
    return h("div", { class: `saved-row${state.source.id === m.id ? " current" : ""}` },
      item(h("span", { class: "saved-name" }, m.name), async () => { const x = await loadModel(m.id); if (x) await openModel(x.text, { kind: "saved", id: x.id }); }, h("span", { class: "when" }, when(m.updated))),
      del);
  };
  modelsMenu.replaceChildren(
    item("New model", () => openModel(newModelText(), { kind: "new", id: null })),
    h("p", { class: "menu-head" }, "Saved in this browser"),
    ...(saved.length ? saved.map(row) : [h("p", { class: "menu-note" }, "Nothing yet. Your changes save here as you make them.")]),
    h("p", { class: "menu-head" }, "Examples"),
    ...examples.map(e => item(e.name, () => openModel(e.text, { kind: "example", id: null }))),
  );
}
$("models").addEventListener("click", async () => {
  if (!modelsMenu.hidden) return closeModels();
  await fillModelsMenu();
  modelsMenu.hidden = false;
  $("models").setAttribute("aria-expanded", "true");
  modelsMenu.querySelector("button")?.focus();
});
document.addEventListener("click", e => { if (!e.target.closest(".menu")) closeModels(); });
modelsMenu.addEventListener("keydown", e => {
  const items = [...modelsMenu.querySelectorAll('[role="menuitem"]')], i = items.indexOf(document.activeElement);
  if (e.key === "Escape") { closeModels(); $("models").focus(); }
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
});
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); flush(); }
});
// Leaving or hiding the tab saves at once; if a save is still due, the browser asks first.
addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
addEventListener("beforeunload", e => { if (state.text !== state.savedText) { flush(); e.preventDefault(); } });

function renameCurrentModel(name) {
  const r = renameModel(state.text, name);
  if (!r.text) { say(r.issues[0]?.message ?? "That name doesn't work"); render(); return; }
  setText(r.text);
}
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

// Opens, in order: a shared link, the model saved here that was open last time, the lantern.
async function start() {
  if (location.hash.length > 1) {
    try {
      const text = decode(location.hash.slice(1));
      state.source = { kind: "shared", id: null };
      state.savedText = text;
      return setText(text);
    } catch { /* bad link: fall through */ }
  }
  try {
    const last = localStorage.getItem("modelgen.last");
    const saved = last && (await loadModel(last));
    if (saved) { state.source = { kind: "saved", id: saved.id }; state.savedText = saved.text; return setText(saved.text); }
  } catch { /* storage off */ }
  const lantern = examples.find(e => e.name === "lantern") ?? examples[0];
  state.savedText = lantern.text;
  setText(lantern.text);
}
start();
