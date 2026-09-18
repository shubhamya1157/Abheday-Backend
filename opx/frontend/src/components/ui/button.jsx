import { cn } from "@/lib/utils";

// The workbench buttons, in the paper room. Corners squared but never sharp
// (10px), so every control looks like it came out of one cabinet. The amber
// "enter" variant is reserved for the one action that runs the agent — same
// amber as the wordmark X.

const variants = {
  // filled ink — the primary action on paper
  solid: "bg-ink text-paper hover:bg-[#22251F] disabled:opacity-40",
  outline: "border border-ink/20 text-ink hover:border-ink/40 hover:bg-ink/[0.04]",
  ghost: "text-ink-muted hover:text-ink hover:bg-ink/[0.04]",
  danger: "border border-denied/40 text-denied hover:border-denied hover:bg-denied/[0.06]",

  // amber, filled. the way into a run.
  enter: "bg-signal text-white hover:bg-[#F07A18] disabled:opacity-40 disabled:hover:bg-signal",
};

const sizes = {
  icon: "h-9 w-9",
  sm: "h-8 px-3.5 text-[12px]",
  md: "h-10 px-5 text-[13px]",
  lg: "h-12 px-7 text-[14px]",
};

export function Button({
  as = "button",
  variant = "outline",
  size = "md",
  className,
  children,
  ...props
}) {
  const Tag = as;
  return (
    <Tag
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-[10px] font-mono uppercase tracking-label",
        "transition-colors duration-200",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}
