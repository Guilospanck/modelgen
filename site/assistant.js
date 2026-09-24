// The Ask tab: describe a change in words, and the visitor's own AI chat answers with modelgen edit
// ops, carried by copy and paste. The page itself talks to no AI and needs no API key.
import { promptFor, followUpFor, parseOpsReply } from "./modelgen.js";
import { h } from "./panels.js";

// app: { state() → { text, doc, issues }, apply(ops) → { changes } | { error }, say(message) }
export function createAssistant(root, app) {
  let pending = null; // what "Copy follow-up" would report: a rejection or leftover problems

  const input = h("textarea", { id: "ask-text", class: "field", rows: 3, placeholder: "Add four legs, 70 cm tall, in dark wood" });
  const reply = h("textarea", { class: "field", rows: 4, placeholder: "Paste the chat's reply here", "aria-label": "The chat's reply" });
  const followUp = h("button", { type: "button", hidden: true, onclick: copyFollowUp }, "Copy follow-up");
  const log = h("ol", { class: "log", "aria-live": "polite" });
  root.replaceChildren(
    h("label", { class: "label", for: "ask-text" }, "What should change?"), input,
    h("p", { class: "note" }, "This page doesn't talk to any AI. Copy the prompt into ChatGPT, Claude, Gemini or whichever chat you use, then paste its reply below."),
    h("button", { type: "button", class: "primary", onclick: copyPrompt }, "Copy prompt"),
    reply,
    h("div", { class: "row-buttons" }, h("button", { type: "button", onclick: applyReply }, "Apply reply"), followUp),
    log);

  const entry = (kind, ...text) => log.prepend(h("li", { class: kind }, ...text));
  const setPending = p => { pending = p; followUp.hidden = !p; };

  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); app.say(`${what} copied. Paste it into your chat.`); }
    catch { app.say("Couldn't reach the clipboard; select the text in the log instead."); entry("prompt", h("pre", {}, text)); }
  }

  async function copyPrompt() {
    const request = input.value.trim();
    if (!request) { input.focus(); return app.say("Describe the change first."); }
    const { text, doc, issues } = app.state();
    if (!doc) return app.say("Fix the YAML problems first.");
    const p = promptFor({ request, text, issues: issues.filter(i => i.severity === "error") });
    setPending(null);
    entry("you", request);
    await copy(`${p.system}\n\n${p.user}`, "Prompt");
  }

  async function copyFollowUp() {
    if (pending) await copy(followUpFor({ ...pending, text: app.state().text }), "Follow-up");
  }

  // Applies the reply's ops; anything left to fix becomes the follow-up.
  function applyReply() {
    if (!reply.value.trim()) return app.say("Paste the chat's reply first.");
    const request = input.value.trim();
    const parsed = parseOpsReply(reply.value);
    if (parsed.error) { entry("error", parsed.error); setPending({ request, rejected: parsed.error }); return; }
    const r = app.apply(parsed.ops);
    if (r.error) { entry("error", `Nothing changed: ${r.error}`); setPending({ request, rejected: r.error }); return; }
    entry("done", r.changes.join("; "));
    reply.value = "";
    const problems = app.state().issues.filter(i => i.severity === "error");
    if (problems.length) {
      entry("error", `Still to fix: ${problems.map(i => i.message).join("; ")}`);
      setPending({ request, issues: problems });
      app.say("Copy the follow-up into the same chat to fix what's left.");
    } else {
      setPending(null);
      app.say("Applied. Undo takes it back.");
    }
  }
}
