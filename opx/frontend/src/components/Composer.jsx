import { useRef } from "react";
import { ArrowUp, Square } from "lucide-react";

// The input row, centered under the conversation. Enter sends, Shift+Enter makes
// a newline. While a run is going the send button becomes a Stop button in the
// same spot, so you never hunt for it. The textarea grows with its content up to
// a cap, then scrolls. One soft rounded field on paper — nothing loud.

export default function Composer({ value, onChange, onSend, onStop, busy }) {
  const ref = useRef(null);

  function resize() {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy && value.trim()) onSend();
    }
  }

  return (
    <div className="px-4 pb-5 pt-2">
      <div className="mx-auto max-w-[46rem]">
        <div className="flex items-end gap-2 rounded-[18px] border border-ink-line bg-paper-2/60 p-2 pl-4 shadow-[0_1px_3px_rgba(11,12,11,0.04)] focus-within:border-ink/30 focus-within:bg-paper-2/90">
          <textarea
            ref={ref}
            rows={1}
            value={value}
            placeholder="Message OPX…"
            onChange={(e) => {
              onChange(e.target.value);
              resize();
            }}
            onKeyDown={onKeyDown}
            className="max-h-[200px] w-full resize-none self-center bg-transparent py-1.5 font-sans text-[15px] leading-relaxed text-ink placeholder:text-ink-muted/60 focus:outline-none"
          />

          {busy ? (
            <button
              onClick={onStop}
              title="Stop the run"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border border-denied/40 text-denied transition-colors hover:bg-denied/[0.06]"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={onSend}
              disabled={!value.trim()}
              title="Send (Enter)"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-signal text-white transition-colors hover:bg-[#F07A18] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-signal"
            >
              <ArrowUp size={17} />
            </button>
          )}
        </div>
        <p className="mt-2 text-center font-mono text-[10px] text-ink-muted/60">
          OPX runs local models and checks every step · Enter to send, Shift+Enter for a new line
        </p>
      </div>
    </div>
  );
}
