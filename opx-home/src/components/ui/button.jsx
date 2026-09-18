import { cn } from "@/lib/utils";

// shadcn-style button, kept simple: variants are just a plain object.
// Corners are squared off but never sharp — same 10px family as the navbar
// bezel, so every control on the page looks like it came out of the same
// cabinet. Status chips stay round, because a light is round.

const variants = {
  // the cream room
  solid: "bg-ink text-paper hover:bg-[#22251F]",
  outlinePaper: "border border-ink/25 text-ink hover:border-ink hover:bg-ink/[0.04]",

  // the machine room
  bone: "bg-bone text-plant hover:bg-white",
  signal: "border border-signal/45 text-signal hover:border-signal hover:bg-signal/[0.08]",
  outline: "border border-line text-bone hover:border-bone-muted hover:bg-white/[0.03]",
  ghost: "text-bone-muted hover:text-bone",

  // Amber, filled. Reserved for one thing only: the button that takes you
  // into OPX. Same colour as the X in the wordmark, so the way in is the
  // same colour in both rooms and you never have to hunt for it.
  enter: "bg-signal text-plant hover:bg-[#FF9C4D]",
};

const sizes = {
  sm: "h-8 px-3.5 text-[12px]",
  md: "h-10 px-5 text-[13px]",
  lg: "h-12 px-7 text-[14px]",
};

export function Button({
  as = "button",
  variant = "solid",
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
