import { cn } from "@/lib/utils";

// A status light. Round, because a light is round — the one thing on the page
// that keeps its circle while every control is squared off.
//
//   tone: "signal" (running), "sealed" (verified/ok), "denied" (blocked),
//         "muted" (idle/unknown)
//   live: add a slow breathe so it reads as "happening right now"

const tones = {
  signal: "bg-signal",
  sealed: "bg-sealed",
  denied: "bg-denied",
  muted: "bg-ink-muted/50",
};

export function Dot({ tone = "muted", live = false, className }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        tones[tone],
        live && "animate-breathe",
        className
      )}
    />
  );
}
