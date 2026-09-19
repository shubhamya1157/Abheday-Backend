import { useState } from "react";
import { ChevronRight, ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { describe, TONE } from "@/lib/trace";

// One turn in the conversation.
//
// User turns sit right, in a soft rounded bubble. The assistant answers full
// width in plain ink — like a person writing, not a chat bubble — with a small
// amber OPX mark beside it. Under each answer is the quiet part: a one-line
// receipt chip (verified / blocked) and a "steps" disclosure that opens the
// full run trace. Folded away by default so the conversation stays readable,
// one click away when you want the proof.

export default function Message({ role, text, meta, events, receipt, streaming, defaultOpen }) {
  if (role === "user") {
    return (
      <div className="mb-6 flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-[16px] rounded-tr-[5px] bg-paper-2 px-4 py-2.5 text-[15px] leading-relaxed text-ink">
          {text}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8 flex gap-3.5">
      {/* the OPX mark, standing in for an avatar */}
      <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[8px] border border-ink-line bg-paper-2/70">
        <span className="wordmark text-[11px] leading-none text-ink">
          O<span className="text-signal">X</span>
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">
          {text}
          {streaming && (
            <span className="ml-0.5 inline-block h-[16px] w-[7px] translate-y-[3px] animate-caret bg-signal" />
          )}
          {!text && streaming && (
            <span className="font-mono text-[13px] text-ink-muted">working…</span>
          )}
        </div>

        {/* the quiet machinery: receipt chip + steps, once the run has anything */}
        {(receipt || (events && events.length > 0)) && (
          <RunDetails meta={meta} events={events} receipt={receipt} defaultOpen={defaultOpen} />
        )}
      </div>
    </div>
  );
}

// The folded-away run. A row of small readouts (model, steps, receipt state)
// that expands to the full, colour-coded step trace. Calm by default.
function RunDetails({ meta, events, receipt, defaultOpen }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const verified = receipt?.verified;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {/* receipt chip — the one bit of colour that always shows */}
        {receipt && (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px]",
              verified
                ? "border-sealed/40 bg-sealed/[0.08] text-[#1F8A4C]"
                : "border-denied/40 bg-denied/[0.06] text-denied"
            )}
          >
            {verified ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
            {verified ? "verified · zero egress" : "unverified"}
          </span>
        )}

        {meta?.model && (
          <span className="font-mono text-[11px] text-ink-muted">
            {meta.model}
            {meta.steps !== undefined && ` · ${meta.steps} steps`}
            {meta.tokens !== undefined && ` · ${meta.tokens} tok`}
          </span>
        )}

        {events && events.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-ink-muted transition-colors hover:text-ink"
          >
            <ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} />
            {open ? "hide steps" : `${events.length} steps`}
          </button>
        )}
      </div>

      {open && events && (
        <ol className="card mt-2.5 space-y-0.5 p-2">
          {events.map((ev, i) => (
            <TraceRow key={i} ev={ev} />
          ))}
        </ol>
      )}
    </div>
  );
}

// One step in the trace. A small colour tag says what kind of step it is
// (guard, model, tool…), red if a guardrail blocked or a tool failed.
function TraceRow({ ev }) {
  const d = describe(ev);
  const tone = TONE[d.kind] ?? TONE.logic;
  const alarm = d.blocked || ev?.result?.ok === false;

  return (
    <li className="flex items-start gap-2.5 rounded-[7px] px-2 py-1.5">
      <span className={cn("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", alarm ? "bg-denied" : tone.bg)} />
      <div className="min-w-0 flex-1">
        <span className={cn("font-mono text-[11px] font-medium", alarm ? "text-denied" : tone.text)}>
          {d.label}
        </span>
        {d.detail && (
          <p className="mt-0.5 break-words font-mono text-[10.5px] leading-snug text-ink-muted">
            {d.detail}
          </p>
        )}
      </div>
    </li>
  );
}
