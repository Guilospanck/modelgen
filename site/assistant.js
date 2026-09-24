// The Ask tab: describe a change in words; a language model answers with modelgen edit ops.
// Who answers: the visitor's own AI chat (copy and paste, the page talks to no AI), a small model
// running in this browser (WebLLM), or the model built into Chrome. No API keys anywhere.
import { promptFor, followUpFor, parseOpsReply, opsSchema } from "./modelgen.js";
import { h } from "./panels.js";

const WEBLLM = "https://esm.run/@mlc-ai/web-llm@0.2.85";
const LOCAL = {
  qwen2b: { id: "Qwen3.5-2B-q4f16_1-MLC", label: "Qwen3.5 2B", download: "1.1 GB", memory: "2.2 GB" },
  qwen4b: { id: "Qwen3.5-4B-q4f16_1-MLC", label: "Qwen3.5 4B", download: "2.4 GB", memory: "3.9 GB" },
};
const RETRIES = 2;
const TEXT_IO = { expectedInputs: [{ type: "text", languages: ["en"] }], expectedOutputs: [{ type: "text", languages: ["en"] }] };

// Some browsers answer slowly or never; after a few seconds, take that as no.
const within = (ms, p) => Promise.race([p, new Promise(r => setTimeout(() => r(undefined), ms))]);
// Listing needs only the API; the graphics card itself is checked when the model loads,
// because the first requestAdapter can take a while as the GPU process starts.
const hasWebGPU = () => !!navigator.gpu;
async function nanoAvailability() {
  if (!("LanguageModel" in globalThis)) return "unavailable";
  try { return (await within(3000, globalThis.LanguageModel.availability(TEXT_IO))) ?? "unavailable"; } catch { return "unavailable"; }
}

// An engine answers one prompt: ask(system, user, schema) → reply text.
async function webllmEngine(model, progress) {
  if (!(await navigator.gpu.requestAdapter())) throw new Error("this browser has WebGPU but found no usable graphics card");
  const worker = new Worker(new URL("./llm-worker.js", import.meta.url), { type: "module" });
  const { CreateWebWorkerMLCEngine } = await import(WEBLLM);
  const engine = await CreateWebWorkerMLCEngine(worker, model.id, { initProgressCallback: r => progress(r.progress, r.text) });
  return {
    async ask(system, user, schema) {
      const r = await engine.chat.completions.create({
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        temperature: 0.2, max_tokens: 1500,
        // Held to the ops schema while it writes, so the reply is always well-formed JSON.
        response_format: { type: "json_object", schema: JSON.stringify(schema) },
        extra_body: { enable_thinking: false },
      });
      return r.choices[0].message.content ?? "";
    },
  };
}
async function nanoEngine(progress) {
  return {
    async ask(system, user, schema) {
      const session = await globalThis.LanguageModel.create({
        ...TEXT_IO, initialPrompts: [{ role: "system", content: system }],
        monitor: m => m.addEventListener("downloadprogress", e => progress(e.loaded, "Chrome is downloading its model")),
      });
      try { return await session.prompt(user, { responseConstraint: schema, omitResponseConstraintInput: true }); }
      finally { session.destroy(); }
    },
  };
}

// app: { state() → { text, doc, issues }, apply(ops) → { changes } | { error }, say(message) }
export function createAssistant(root, app) {
  const engines = {}; // loaded engines, by key
  let busy = false, pending = null; // pending: what "Copy follow-up" would send

  const input = h("textarea", { id: "ask-text", class: "field", rows: 3, placeholder: "Add four legs, 70 cm tall, in dark wood" });
  const picker = h("select", { id: "ask-engine", onchange: () => { remember(picker.value); renderActions(); } });
  const note = h("p", { class: "note" });
  const actions = h("div", { class: "ask-actions" });
  const bar = h("progress", { max: 1, value: 0, hidden: true });
  const log = h("ol", { class: "log", "aria-live": "polite" });
  root.replaceChildren(
    h("label", { class: "label", for: "ask-text" }, "What should change?"), input,
    h("label", { class: "label", for: "ask-engine" }, "Who answers"), picker, note, actions, bar, log);

  const entry = (kind, ...text) => { log.prepend(h("li", { class: kind }, ...text)); };
  const remember = v => { try { localStorage.setItem("modelgen.engine", v); } catch { /* storage off: fine */ } };
  const recalled = () => { try { return localStorage.getItem("modelgen.engine"); } catch { return null; } };

  // Copy and paste always works, so it's there at once; the local options join when detected.
  picker.append(h("option", { value: "copy" }, "Your own AI chat (copy and paste)"));
  renderActions();
  (async () => {
    const gpu = hasWebGPU(), nano = await nanoAvailability();
    for (const [key, m] of Object.entries(LOCAL))
      picker.append(h("option", { value: key, disabled: !gpu }, `In this browser: ${m.label}, ${m.download} download${gpu ? "" : " (needs WebGPU)"}`));
    if (nano !== "unavailable") picker.append(h("option", { value: "nano" }, "Chrome's built-in model"));
    // Redraw only if the choice changed, so a reply being pasted isn't wiped.
    const last = recalled();
    if (last && last !== picker.value && picker.querySelector(`option[value="${last}"]:not([disabled])`)) { picker.value = last; renderActions(); }
  })();

  function renderActions() {
    const key = picker.value, local = LOCAL[key];
    note.textContent = key === "copy"
      ? "This page doesn't talk to any AI. Copy the prompt into ChatGPT, Claude, Gemini or whichever chat you use, then paste its reply below."
      : local
        ? `Runs on your computer's graphics card: a ${local.download} download the first time (this browser keeps it) and about ${local.memory} of graphics memory. Nothing you type leaves your computer. Small models handle simple changes best, like "make the handle thicker".`
        : "Uses the model built into Chrome. Nothing you type leaves your computer.";
    if (key === "copy") {
      const reply = h("textarea", { class: "field", rows: 4, placeholder: "Paste the chat's reply here", "aria-label": "The chat's reply" });
      actions.replaceChildren(
        h("button", { type: "button", class: "primary", onclick: copyPrompt }, "Copy prompt"),
        reply,
        h("div", { class: "row-buttons" },
          h("button", { type: "button", onclick: () => applyReply(reply) }, "Apply reply"),
          pending ? h("button", { type: "button", onclick: copyFollowUp }, "Copy follow-up") : null));
    } else {
      actions.replaceChildren(h("button", { type: "button", class: "primary", disabled: busy, onclick: runLocal }, busy ? "Working…" : "Ask"));
    }
  }

  const request = () => {
    const r = input.value.trim();
    if (!r) { input.focus(); app.say("Describe the change first."); }
    return r;
  };
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); app.say(`${what} copied. Paste it into your chat.`); }
    catch { app.say("Couldn't reach the clipboard; select the text in the log instead."); entry("prompt", h("pre", {}, text)); }
  }

  async function copyPrompt() {
    const r = request();
    const { text, doc, issues } = app.state();
    if (!r) return;
    if (!doc) return app.say("Fix the YAML problems first.");
    const p = promptFor({ request: r, text, issues: issues.filter(i => i.severity === "error") });
    pending = { request: r };
    entry("you", r);
    await copy(`${p.system}\n\n${p.user}`, "Prompt");
    renderActions();
  }
  async function copyFollowUp() {
    const { text } = app.state();
    await copy(followUpFor({ ...pending, text }), "Follow-up");
  }

  // Applies a reply's ops; returns what happened so a follow-up can report it.
  function take(reply, request) {
    const parsed = parseOpsReply(reply);
    if (parsed.error) { entry("error", parsed.error); return { request, rejected: parsed.error }; }
    const r = app.apply(parsed.ops);
    if (r.error) { entry("error", `Nothing changed: ${r.error}`); return { request, rejected: r.error }; }
    entry("done", r.changes.join("; "));
    const problems = app.state().issues.filter(i => i.severity === "error");
    if (problems.length) { entry("error", `Still to fix: ${problems.map(i => i.message).join("; ")}`); return { request, issues: problems }; }
    return null;
  }

  function applyReply(box) {
    if (!box.value.trim()) return app.say("Paste the chat's reply first.");
    pending = take(box.value, pending?.request ?? input.value.trim());
    if (pending) app.say("Copy the follow-up into the same chat to fix what's left.");
    else { box.value = ""; app.say("Applied. Undo takes it back."); }
    renderActions();
  }

  async function runLocal() {
    const r = request();
    if (!r || busy) return;
    if (!app.state().doc) return app.say("Fix the YAML problems first.");
    busy = true;
    renderActions();
    entry("you", r);
    try {
      const key = picker.value;
      if (!engines[key]) {
        bar.hidden = false;
        const progress = (p, text) => { bar.value = p ?? 0; app.say(text ?? "Loading the model…"); };
        engines[key] = await (key === "nano" ? nanoEngine(progress) : webllmEngine(LOCAL[key], progress));
        bar.hidden = true;
      }
      let next = null;
      for (let attempt = 0; attempt <= RETRIES; attempt++) {
        const { text, doc, issues } = app.state();
        const p = promptFor({ request: r, text, issues: issues.filter(i => i.severity === "error"), compact: true });
        app.say(attempt ? `Fixing what's left (try ${attempt + 1} of ${RETRIES + 1})…` : "Thinking…");
        const reply = await engines[key].ask(p.system, next ? followUpFor({ ...next, text }) : p.user, opsSchema(doc));
        next = take(reply, r);
        if (!next) { app.say("Done. Undo takes it back."); break; }
      }
      if (next) app.say("The model couldn't finish this one. Try smaller steps, or use your own AI chat.");
    } catch (e) {
      bar.hidden = true;
      entry("error", `The model stopped: ${e.message}`);
      app.say("The in-browser model failed; your own AI chat (copy and paste) always works.");
    } finally {
      busy = false;
      renderActions();
    }
  }
}
