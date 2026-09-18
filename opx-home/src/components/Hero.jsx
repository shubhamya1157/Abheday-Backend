import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

// Room 1: the plant office. Paper, black type, the punch line.
//
// The load is one orchestrated sequence, not a pile of separate effects:
// line 1 -> line 2 -> a beat -> the quiet turn -> paragraph -> buttons -> nav.
// Each delay below is that beat, in seconds.

const line = {
  hidden: { y: "108%" },
  show: { y: "0%" },
};

const ease = [0.16, 1, 0.3, 1];

export default function Hero() {
  return (
    <section id="top" className="relative bg-paper px-4 pb-20 pt-28 sm:px-6 sm:pt-32">
      <div className="mx-auto max-w-page">
        <div className="relative overflow-hidden rounded-[16px] border border-ink/15 bg-paper-2/60 px-5 py-20 sm:px-10 sm:py-28">
          {/* the faint engineering grid, masked so it never fights the type */}
          <div className="grid-lines-paper grid-mask pointer-events-none absolute inset-0" />

          <div className="relative">
            {/* THE PUNCH LINE */}
            <h1 className="punch text-center text-[clamp(2.9rem,11vw,9rem)]">
              <span className="reveal-mask">
                <motion.span
                  variants={line}
                  initial="hidden"
                  animate="show"
                  transition={{ duration: 1.05, delay: 0.2, ease }}
                  className="block"
                >
                  Nothing leaves
                </motion.span>
              </span>
              <span className="reveal-mask">
                <motion.span
                  variants={line}
                  initial="hidden"
                  animate="show"
                  transition={{ duration: 1.05, delay: 0.35, ease }}
                  className="block"
                >
                  the room
                </motion.span>
              </span>
            </h1>

            {/* The quiet turn. Giant shouting type, then this — small and calm.
                It is the one serif on the page: mono would just blend in with
                every other little label, but an italic serif sounds like a
                person talking back to all that machinery. */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 0.95 }}
              className="mt-7 flex items-center justify-center gap-3 sm:gap-4"
            >
              <motion.span
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, delay: 0.95, ease }}
                className="h-px w-8 origin-right bg-signal sm:w-14"
              />
              <span className="aside text-[19px] leading-none text-ink sm:text-[26px]">
                Opx
              </span>
              <motion.span
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.5, delay: 0.95, ease }}
                className="h-px w-8 origin-left bg-signal sm:w-14"
              />
            </motion.div>

            {/* one paragraph, and it says what the thing does */}
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 1.1 }}
              className="mx-auto mt-9 max-w-[54ch] text-center text-[15px] leading-relaxed text-ink-muted sm:text-[17px]"
            >
             OPX is a local-first AI platform that runs open-weight models on your own infrastructure, with built-in agent loops, tool orchestration, and guardrails to ensure every action is controlled, secure.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 1.25 }}
              className="mt-10 flex flex-wrap items-center justify-center gap-3"
            >
              <Button as="a" href="#enter" size="lg" variant="enter">
                Enter OPX
              </Button>
              <Button as="a" href="#how-it-works" size="lg" variant="outlinePaper">
                See how it works
              </Button>
            </motion.div>
          </div>

          {/* The last beat of the load: an amber line draws itself along the
              bottom edge of the panel. It is the seam between the two rooms —
              paper above it, machine room below. */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.2, delay: 1.5, ease }}
            className="absolute inset-x-0 bottom-0 h-px origin-left bg-signal"
          />
        </div>
      </div>
    </section>
  );
}
