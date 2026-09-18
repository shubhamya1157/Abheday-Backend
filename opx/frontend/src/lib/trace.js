// Maps a run event to how the trace should draw it: a node colour (what the
// step IS), a short label, and the interesting one-line detail. Tailwind can't
// see interpolated class names, so the colour classes are written out in full
// in TONE below — never build them as `text-node-${x}`.

export const TONE = {
  trigger: { text: "text-node-trigger", bg: "bg-node-trigger", border: "border-node-trigger/40" },
  logic: { text: "text-node-logic", bg: "bg-node-logic", border: "border-node-logic/40" },
  guard: { text: "text-node-guard", bg: "bg-node-guard", border: "border-node-guard/40" },
  model: { text: "text-node-model", bg: "bg-node-model", border: "border-node-model/40" },
  tool: { text: "text-node-tool", bg: "bg-node-tool", border: "border-node-tool/40" },
  out: { text: "text-node-out", bg: "bg-node-out", border: "border-node-out/40" },
};

// One place that decides, for each event type, its node kind + label + detail.
export function describe(ev) {
  switch (ev.type) {
    case "run_start":
      return { kind: "trigger", label: "run start", detail: ev.model ? `model ${ev.model}` : "" };
    case "step_start":
      return { kind: "logic", label: `step ${ev.step}`, detail: "" };
    case "assistant_message":
      return {
        kind: "model",
        label: "model",
        detail: ev.finishReason === "tool_calls" ? "wants a tool" : "answered",
      };
    case "tool_call":
      return { kind: "tool", label: `call ${ev.call?.name ?? "tool"}`, detail: preview(ev.call?.args) };
    case "tool_result":
      return {
        kind: "tool",
        label: `result ${ev.call?.name ?? ""}`.trim(),
        detail: ev.result?.ok ? clip(ev.result?.content) : `error: ${clip(ev.result?.error)}`,
        ok: ev.result?.ok,
      };
    case "guardrail":
      return {
        kind: "guard",
        label: `guard ${ev.action}`,
        detail: `${ev.guard} · ${ev.reason}`,
        blocked: ev.action === "block",
      };
    case "compaction":
      return {
        kind: "logic",
        label: "memory compaction",
        detail: `${ev.droppedMessages} msgs · ${ev.tokensBefore}→${ev.tokensAfter} tok`,
      };
    case "notice":
      return { kind: "logic", label: `notice`, detail: ev.message };
    case "run_end":
      return { kind: "out", label: "run end", detail: ev.outcome?.stopReason ?? "" };
    default:
      return { kind: "logic", label: ev.type, detail: "" };
  }
}

function preview(args) {
  if (!args) return "";
  return clip(JSON.stringify(args));
}

function clip(s, n = 120) {
  if (!s) return "";
  const str = String(s);
  return str.length > n ? str.slice(0, n) + "…" : str;
}
