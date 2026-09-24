import { buildModel, VERSION } from "./modelgen.js";
import { createViewer } from "./viewer.js";

const $ = id => document.getElementById(id);
const yaml = $("yaml"), issuesEl = $("issues"), status = $("status");
const buttons = { glb: $("glb"), usdz: $("usdz") };
let current = { name: "model", files: {} }, timer;
const viewer = createViewer($("viewer"), { onScale: step => { $("scale").textContent = `Grid squares: ${step}`; } });

const examples = await (await fetch("examples.json")).json();
for (const e of examples) $("example").append(new Option(e.name, e.name));

// A shared link carries the model in the URL hash.
const encode = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0)));
let initial = examples.find(e => e.name === "lantern") ?? examples[0];
if (location.hash.length > 1) {
  try {
    initial = { name: "shared", text: decode(location.hash.slice(1)) };
    $("example").prepend(new Option("Shared link", "shared"));
  } catch { /* bad link: fall back to the example */ }
}
$("example").value = initial.name;
yaml.value = initial.text;

const kb = n => n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

function render(issues) {
  issuesEl.replaceChildren(...issues.map(i => {
    const li = document.createElement("div");
    li.className = `issue ${i.severity}`;
    const message = i.message.replace(/^model\.yaml:?\s*/, "");
    li.append(Object.assign(document.createElement("p"), { textContent: message }));
    if (i.hint) li.append(Object.assign(document.createElement("p"), { className: "hint", textContent: i.hint }));
    return li;
  }));
}

function rebuild() {
  const t0 = performance.now();
  let result;
  try { result = buildModel(yaml.value); } catch (e) { result = { files: [], issues: [{ severity: "error", code: "internal", message: `modelgen crashed: ${e.message}`, hint: "this is a modelgen bug; please report it" }] }; }
  const ms = Math.round(performance.now() - t0);
  render(result.issues);
  const ok = result.files.length > 0 && !result.issues.some(i => i.severity === "error");
  $("stale").hidden = ok || !viewer.hasModel;
  if (!ok) { status.textContent = "Didn't build"; return; }

  const files = Object.fromEntries(result.files.map(f => [f.format, f.data]));
  current = { name: result.name, files };
  viewer.show(files.glb, result.name).catch(e => { status.textContent = `Preview failed: ${e.message}`; });
  for (const f of ["glb", "usdz"]) { buttons[f].disabled = !files[f]; buttons[f].title = files[f] ? kb(files[f].length) : ""; }
  status.textContent = `Built ${result.name} in ${ms} ms`;
}

function download(format) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([current.files[format]]));
  a.download = `${current.name}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

yaml.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(rebuild, 300); });
yaml.addEventListener("keydown", e => {
  if (e.key !== "Tab" || e.shiftKey) return;
  e.preventDefault();
  yaml.setRangeText("  ", yaml.selectionStart, yaml.selectionEnd, "end");
  yaml.dispatchEvent(new Event("input"));
});
$("example").addEventListener("change", e => {
  const example = examples.find(x => x.name === e.target.value);
  if (!example) return;
  yaml.value = example.text;
  history.replaceState(null, "", location.pathname);
  rebuild();
});
buttons.glb.addEventListener("click", () => download("glb"));
buttons.usdz.addEventListener("click", () => download("usdz"));
$("share").addEventListener("click", async () => {
  history.replaceState(null, "", `#${encode(yaml.value)}`);
  try { await navigator.clipboard.writeText(location.href); status.textContent = "Link copied"; }
  catch { status.textContent = "Link is in the address bar"; }
});
document.querySelector("h1").title = `modelgen ${VERSION}`;
rebuild();
