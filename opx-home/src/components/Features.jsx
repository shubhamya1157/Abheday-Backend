import { motion } from "motion/react";
import {
  EyeOff,
  ListChecks,
  Unplug,
  Lock,
  FolderLock,
  WifiOff,
  Wrench,
  ListOrdered,
  ToggleLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Nine promises, each one a real panel instead of a line of text.
//
// The colour is not decoration: every card takes the colour of the part of
// the run it belongs to, so a card and its node on the How-it-works canvas
// are the same colour. On a wide screen the middle row comes out entirely
// cyan, which is the honest shape of this product — a third of it is guards.
//
// One card is lit permanently: the egress guard, because that is the claim
// the whole product is graded on.
//
// Class names are written out in full below. Tailwind only generates strings
// it can literally find in the file, so `text-node-${type}` would silently
// produce no colour at all.

const EASE = [0.16, 1, 0.3, 1];

const TONE = {
  trigger: {
    label: "request",
    chip: "border-node-trigger/40 text-node-trigger",
    tint: "bg-node-trigger/10",
    top: "via-node-trigger/50",
    edge: "hover:border-node-trigger/40",
    on: "border-node-trigger/45",
    glow: "bg-node-trigger/20",
  },
  logic: {
    label: "logic",
    chip: "border-node-logic/40 text-node-logic",
    tint: "bg-node-logic/10",
    top: "via-node-logic/50",
    edge: "hover:border-node-logic/40",
    on: "border-node-logic/45",
    glow: "bg-node-logic/20",
  },
  guard: {
    label: "guard",
    chip: "border-node-guard/40 text-node-guard",
    tint: "bg-node-guard/10",
    top: "via-node-guard/50",
    edge: "hover:border-node-guard/40",
    on: "border-node-guard/45",
    glow: "bg-node-guard/20",
  },
  model: {
    label: "model",
    chip: "border-node-model/40 text-node-model",
    tint: "bg-node-model/10",
    top: "via-node-model/50",
    edge: "hover:border-node-model/40",
    on: "border-node-model/45",
    glow: "bg-node-model/20",
  },
  tool: {
    label: "tool",
    chip: "border-node-tool/40 text-node-tool",
    tint: "bg-node-tool/10",
    top: "via-node-tool/50",
    edge: "hover:border-node-tool/40",
    on: "border-node-tool/45",
    glow: "bg-node-tool/20",
  },
  out: {
    label: "output",
    chip: "border-node-out/40 text-node-out",
    tint: "bg-node-out/10",
    top: "via-node-out/50",
    edge: "hover:border-node-out/40",
    on: "border-node-out/45",
    glow: "bg-node-out/20",
  },
};

// Read the grid left to right and you have walked the run: the way in, the
// model, the guards, the tools, what comes out.
const FEATURES = [
  {
    name: "The page never sees the model",
    type: "trigger",
    icon: EyeOff,
    body:
      "The browser opens a stream and listens. It is never handed a model endpoint, so there is nothing in the front end for anyone to point somewhere else.",
  },
  {
    name: "Nothing trusted on the way in",
    type: "logic",
    icon: ListChecks,
    body:
      "The request is parsed against a schema rather than trusted. Anything that does not match is refused before a single token is generated.",
  },
  {
    name: "No vendor SDK",
    type: "model",
    icon: Unplug,
    body:
      "The model client is plain fetch, written by hand. Point it at llama.cpp or LM Studio by changing one URL — nothing in the tree knows a vendor exists.",
  },
  {
    name: "Guards that fail closed",
    type: "guard",
    icon: Lock,
    body:
      "Four hooks run around every tool call, and a hook that throws counts as a deny. Silence is a refusal here, never an approval.",
  },
  {
    name: "A jail for paths",
    type: "guard",
    icon: FolderLock,
    body:
      "Checked twice: the path you asked for, then the real path once symlinks resolve. A ../../ and a clever symlink both end the same way.",
  },
  {
    // the one card that stays lit
    name: "The egress guard",
    type: "guard",
    icon: WifiOff,
    featured: true,
    body:
      "fetch is replaced at boot with one that refuses every host but the local model. The allow-list is empty, and filling it is a code change somebody signs off, not a setting somebody forgets.",
  },
  {
    name: "Five tools, all boring",
    type: "tool",
    icon: Wrench,
    body:
      "Read, write, list, stat, search. No shell and no network tool — everything interesting happens in the loop around them, so there is very little surface to get wrong.",
  },
  {
    name: "Ordered receipts",
    type: "out",
    icon: ListOrdered,
    body:
      "Every event carries a number: 1, 2, 3. Verification walks the sequence and names the exact index where it breaks. Ordered and gap-checked — no keys, nothing to lose.",
  },
  {
    name: "The switch ships off",
    type: "logic",
    icon: ToggleLeft,
    body:
      "Web search exists and is disabled. Turn it on and OPX stops reporting itself as air-gapped, in front of everyone. There is no quiet exit.",
  },
];

export default function Features() {
  return (
    <section
      id="features"
      className="relative overflow-hidden border-t border-line bg-plant px-4 py-24 sm:px-6 sm:py-28"
    >
      {/* Two cheap things that stop this room reading as flat black: the same
          faint engineering grid the hero panel uses, and one pool of light
          coming in from the top edge. */}
      <div className="grid-lines grid-mask pointer-events-none absolute inset-0" />
      <div className="room-glow pointer-events-none absolute inset-x-0 top-0 h-[440px]" />

      <div className="relative mx-auto max-w-page">
        {/* One word, centred over the grid — same as the FAQ heading. The type
            label in each card's corner says which part of the run it belongs
            to, so the colour still explains itself without a legend. */}
        <h2 className="head text-center text-[clamp(2.1rem,5.4vw,3.7rem)] text-bone">
          Features
        </h2>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, i) => {
            const tone = TONE[feature.type];
            const Icon = feature.icon;

            return (
              <motion.div
                key={feature.name}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.3 }}
                // stagger across the row, not down the whole grid
                transition={{ duration: 0.5, delay: (i % 3) * 0.07, ease: EASE }}
                className="group relative"
              >
                {/* The card's own colour, pooled underneath it. Always on for
                    the featured card, on hover for the rest. */}
                <div
                  className={cn(
                    "pointer-events-none absolute -inset-1 rounded-[22px] blur-2xl transition-opacity duration-500",
                    tone.glow,
                    feature.featured ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                  )}
                />

                <div
                  className={cn(
                    "relative flex h-full flex-col overflow-hidden rounded-[16px] border bg-gradient-to-b from-plant-3 to-plant-2 p-6 transition-colors duration-300",
                    feature.featured ? tone.on : "border-line",
                    tone.edge
                  )}
                >
                  {/* light along the top edge, fading out at both ends */}
                  <motion.div
                    initial={{ scaleX: 0 }}
                    whileInView={{ scaleX: 1 }}
                    viewport={{ once: true, amount: 0.3 }}
                    transition={{ duration: 0.8, delay: 0.12, ease: EASE }}
                    className={cn(
                      "absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent to-transparent",
                      tone.top
                    )}
                  />

                  <div className="flex items-start justify-between gap-3">
                    {/* the icon tile, in the colour of this part of the run */}
                    <span
                      className={cn(
                        "flex h-11 w-11 items-center justify-center rounded-[10px] border",
                        tone.chip,
                        tone.tint
                      )}
                    >
                      <Icon size={19} strokeWidth={1.75} />
                    </span>

                    <span className="label mt-1 text-[9px] text-bone-muted/45">
                      {String(i + 1).padStart(2, "0")} · {tone.label}
                    </span>
                  </div>

                  <h3 className="head mt-7 text-[16.5px] leading-tight text-bone">
                    {feature.name}
                  </h3>
                  <p className="mt-3 text-[13.5px] leading-relaxed text-bone-muted">
                    {feature.body}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
