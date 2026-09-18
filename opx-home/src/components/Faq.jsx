import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// The awkward questions, asked before a judge has to ask them.
//
// One centred stack, one answer open at a time. The open row is the only
// amber thing here, for the same reason amber marks the running node on the
// canvas: it means this is the one that is live right now.
//
// Rule for the copy in this file: if an answer cannot be checked on the
// machine in the room, it does not go in. Two of them say "no" on purpose.

const EASE = [0.16, 1, 0.3, 1];

const QUESTIONS = [
  {
    q: "Is it really air-gapped, or just politely configured?",
    a: "At boot, fetch is replaced with a version that refuses every host except the local model, so the block covers the whole process — including any dependency that decided to phone home. The allow-list ships empty. Do not take the page's word for it: run a network monitor beside the demo, or pull the cable and ask again.",
  },
  {
    q: "Which model does it run?",
    a: "Open weights only, served locally by llama.cpp or LM Studio. The default is a small instruct model, because a demo that only works on borrowed hardware is not a demo. The client is one hand-written fetch call, so moving to a bigger model is a URL and a name.",
  },
  {
    q: "Does it need a GPU?",
    a: "No. Tokens are forwarded to the browser the moment they arrive instead of being buffered into one reply, which is why a small model on a CPU still feels like something is happening. A GPU makes it faster. It does not make it possible.",
  },
  {
    q: "What stops the model from reading the wrong files?",
    a: "A path jail with two layers. The first rejects the string itself — .. , absolute escapes, anything that climbs. The second resolves the path on disk and checks where it actually lands, so a symlink pointing out of the workspace still fails. One layer is not enough: the string can be innocent and the disk can disagree.",
  },
  {
    q: "What happens if one of the guards has a bug?",
    a: "The tool call does not happen. Every hook has to return allow, and a hook that throws is counted as a deny rather than a warning. A broken guard makes OPX useless, not permissive — that is the whole meaning of fail-closed.",
  },
  {
    q: "Is the receipt tamper-proof?",
    a: "No, and OPX does not claim it is. Every event carries a sequence number, and verification checks that they run 1 to N with nothing missing, naming the exact index where the sequence breaks. It is an ordered, gap-checked receipt: no keys, no signatures, nothing to lose.",
  },
  {
    q: "What do I actually get at the end of a run?",
    a: "A file in a folder, not a chat reply you have to copy somewhere — a note sheet written in the plant's own vocabulary, with its tag numbers in it. Text artifacts today; drawings and scans are named as future work rather than promised now.",
  },
  {
    q: "Does it need the internet to get installed?",
    a: "Once, to pull dependencies and the model weights onto the machine, the same way you install anything. After that the box can be sealed. The demo is meant to run on hardware standing in the room, because an air-gapped system shown off a rented cloud GPU proves the opposite of the point.",
  },
  {
    q: "Can I turn web search on?",
    a: "It is in there and it ships off. Turn it on and OPX stops reporting itself as air-gapped — the status flips where everyone can see it. The point is not that the feature is impossible; the point is that there is no quiet exit.",
  },
  {
    q: "How do I check any of this without trusting this page?",
    a: "Three ways, none of which involve us. Watch the network from outside the process while a run happens. Read the loop — it is small on purpose: five tools, four hooks. Verify the receipt sequence yourself. If any of the three disagrees with what is written here, believe the machine.",
  },
];

export default function Faq() {
  // which row is open. null means all of them are shut.
  const [open, setOpen] = useState(0);

  return (
    <section
      id="faq"
      className="relative overflow-hidden border-t border-line bg-plant px-4 py-24 sm:px-6 sm:py-28"
    >
      <div className="grid-lines grid-mask pointer-events-none absolute inset-0" />

      <div className="relative mx-auto max-w-page">
        {/* the heading, centred over the stack */}
        <div className="mx-auto max-w-[46rem] text-center">
          {/* <span className="label inline-flex items-center gap-2.5 text-bone-muted/60">
          </span> */}

          <h2 className="head mt-5 text-[clamp(2.1rem,5.4vw,3.7rem)] text-bone">
            FAQ
          </h2>
        </div>

        {/* the questions */}
        <div className="mx-auto mt-12 flex max-w-[58rem] flex-col gap-3.5">
          {QUESTIONS.map((item, i) => {
            const isOpen = open === i;

            return (
              <motion.div
                key={item.q}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.45, ease: EASE }}
                className={cn(
                  "overflow-hidden rounded-[14px] border bg-gradient-to-b from-plant-3 to-plant-2 transition-colors duration-300",
                  isOpen ? "border-signal/45" : "border-line hover:border-bone-muted/30"
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${i}`}
                  className="flex w-full items-center gap-4 px-6 py-5 text-left"
                >
                  <span className="flex-1 text-[15px] font-semibold leading-snug text-bone sm:text-[16px]">
                    {item.q}
                  </span>

                  {/* The chevron turns over when the row opens, and it is the
                      only amber thing here — same as amber on the canvas: this
                      is the one that is live right now. */}
                  <motion.span
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    transition={{ duration: 0.3, ease: EASE }}
                    className={cn(
                      "shrink-0 transition-colors duration-300",
                      isOpen ? "text-signal" : "text-bone-muted/60"
                    )}
                  >
                    <ChevronDown size={18} strokeWidth={2} />
                  </motion.span>
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`faq-answer-${i}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <p className="mx-6 border-t border-line py-5 text-[13.5px] leading-relaxed text-bone-muted sm:text-[14px]">
                        {item.a}
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
