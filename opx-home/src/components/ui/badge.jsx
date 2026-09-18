import { cn } from "@/lib/utils";

// Small status chip. On this page a badge always reports a real state:
// amber = running, green = verified, red = refused. Never decoration.

const tones = {
  signal: "border-signal/35 text-signal",
  sealed: "border-sealed/35 text-sealed",
  denied: "border-denied/40 text-denied",
  muted: "border-line text-bone-muted",
  ink: "border-ink/20 text-ink-muted",
};

export function Badge({ tone = "muted", dot = false, className, children }) {
  return (
    <span
      className={cn(
        "label inline-flex items-center gap-2 rounded-full border px-2.5 py-1 leading-none",
        tones[tone],
        className
      )}
    >
      {dot && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            tone === "signal" && "animate-breathe bg-signal",
            tone === "sealed" && "bg-sealed",
            tone === "denied" && "bg-denied",
            tone === "muted" && "bg-bone-muted",
            tone === "ink" && "bg-ink-muted"
          )}
        />
      )}
      {children}
    </span>
  );
}
