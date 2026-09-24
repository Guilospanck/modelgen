// The Ask tab: describe a change in words, and the visitor's own AI chat answers with modelgen edit
// ops, carried by copy and paste. The page itself talks to no AI and needs no API key.
import { promptFor, followUpFor, parseOpsReply } from "./modelgen.js";
import { h } from "./panels.js";

// app: { state() → { text, doc, issues }, apply(ops) → { changes } | { error }, say(message) }
export function createAssistant(root, app) {
  let pending = null; // what "Copy follow-up" would report: a rejection or leftover problems
  let turn = null;    // the history entry of the request being worked on

  const input = h("textarea", { id: "ask-text", class: "field", rows: 3, placeholder: "Add four legs, 70 cm tall, in dark wood" });
  const reply = h("textarea", { class: "field", rows: 3, placeholder: "Paste the chat's reply here", "aria-label": "The chat's reply" });
  // The outcome of the last reply lives here, apart from the history.
  const result = h("div", { class: "result", role: "status", hidden: true });
  const history = h("ol", { class: "turns" });
  root.replaceChildren(
    h("div", { class: "ask-form" },
      h("label", { class: "label", for: "ask-text" }, "What should change?"), input,
      h("p", { class: "note" }, "This page doesn't talk to any AI. Copy the prompt into ChatGPT, Claude, Gemini or whichever chat you use, then paste its reply below."),
      h("button", { type: "button", class: "primary", onclick: copyPrompt }, "Copy prompt"),
      reply,
      h("button", { type: "button", onclick: applyReply }, "Apply reply"),
      result),
    h("section", { class: "history", "aria-label": "History" },
      h("h3", {}, "History"),
      h("div", { class: "scroll" }, history, h("p", { class: "empty-note" }, "Your requests show up here."))));

  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); app.say(`${what} copied. Paste it into your chat.`); }
    catch {
      app.say("Couldn't reach the clipboard; copy the text from the box below instead.");
      showResult("info", `${what}: select all and copy`, h("textarea", { class: "field", rows: 4, readOnly: true, value: text }));
    }
  }

  function showResult(kind, title, ...body) {
    result.className = `result ${kind}`;
    result.hidden = false;
    result.replaceChildren(h("p", { class: "title" }, title), ...body);
  }

  // A request starts a history entry; each reply pasted for it adds one line.
  function startTurn(request) {
    turn = { request, replies: h("ol", { class: "replies" }), n: 0 };
    history.prepend(h("li", {}, h("p", { class: "request" }, request), turn.replies));
  }
  function logReply(kind, summary) {
    if (!turn) startTurn(input.value.trim() || "(no request written)");
    turn.n += 1;
    turn.replies.append(h("li", { class: kind }, `Reply ${turn.n}: ${summary}`));
  }

  async function copyPrompt() {
    const request = input.value.trim();
    if (!request) { input.focus(); return app.say("Describe the change first."); }
    const { text, doc, issues } = app.state();
    if (!doc) return app.say("Fix the YAML problems first.");
    const p = promptFor({ request, text, issues: issues.filter(i => i.severity === "error") });
    pending = null;
    result.hidden = true;
    startTurn(request);
    await copy(`${p.system}\n\n${p.user}`, "Prompt");
  }

  async function copyFollowUp() {
    if (pending) await copy(followUpFor({ ...pending, text: app.state().text }), "Follow-up");
  }
  const followUpButton = () => h("button", { type: "button", class: "primary", onclick: copyFollowUp }, "Copy follow-up");

  // Applies the reply's ops; anything left to fix becomes the follow-up.
  function applyReply() {
    if (!reply.value.trim()) return app.say("Paste the chat's reply first.");
    const request = turn?.request ?? input.value.trim();
    const parsed = parseOpsReply(reply.value);
    const r = parsed.error ? { error: parsed.error } : app.apply(parsed.ops);
    if (r.error) {
      pending = { request, rejected: r.error };
      logReply("bad", "nothing changed");
      showResult("bad", "Nothing changed", h("p", {}, r.error), h("p", { class: "hint" }, "Send the follow-up to the same chat; it explains what went wrong."), followUpButton());
      return;
    }
    reply.value = "";
    const problems = app.state().issues.filter(i => i.severity === "error");
    const changes = r.changes.join("; ");
    if (problems.length) {
      pending = { request, issues: problems };
      const n = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
      logReply("warn", `${changes} · ${n} left`);
      // The problems themselves are in the Problems list below; this says what to do next.
      showResult("warn", `Applied, but ${n} left`,
        h("p", { class: "hint" }, "They're listed under Problems. Send the follow-up to the same chat, or use Fix there."), followUpButton());
    } else {
      pending = null;
      logReply("ok", changes);
      showResult("ok", "Done", h("p", {}, changes), h("p", { class: "hint" }, "Undo takes it back."));
    }
  }
}
