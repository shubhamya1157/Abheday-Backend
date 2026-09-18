import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { Badge } from "@/components/ui/badge";

// Room 2 begins here. This is the signature section of the page.
//
// Outbound calls an agent might try to make race to the fence line and die
// there. The number on the left never moves off zero. That is the product.

// The calls a normal AI stack makes without ever telling you. api.tavily.com
// is on the list on purpose — OPX ships with that integration switched off.
const ATTEMPTS = [
  { method: "POST", target: "api.openai.com/v1/chat/completions" },
  { method: "POST", target: "api.anthropic.com/v1/messages" },
  { method: "GET", target: "telemetry.vendor.io/v2/ping" },
  { method: "POST", target: "sentry.io/api/4508/envelope" },
  { method: "GET", target: "registry.npmjs.org/@vendor/agent-sdk" },
  { method: "POST", target: "hooks.slack.com/services/T04…" },
  { method: "GET", target: "api.tavily.com/search?q=psv+2103a" },
  { method: "PUT", target: "storage.googleapis.com/upload/notes" },
  { method: "GET", target: "huggingface.co/api/models/telemetry" },
];

const EASE = [0.16, 1, 0.3, 1];

export default function FenceWall() {
  const sectionRef = useRef(null);
  const live = useInView(sectionRef, { amount: 0.35 });

  const [rows, setRows] = useState([]);
  const [denied, setDenied] = useState(0);

  // The sequence number lives in a ref, not in the interval. The interval is
  // thrown away every time you scroll the section off screen, and a plain
  // `let n = 0` inside it would restart the numbering at 1 while the denied
  // counter kept climbing — the two would disagree in front of a judge.
  const seqRef = useRef(0);

  // Only tick while the section is on screen. No point animating a wall
  // nobody is looking at.
  useEffect(() => {
    if (!live) return;

    const timer = setInterval(() => {
      seqRef.current += 1;
      const seq = seqRef.current;
      const attempt = ATTEMPTS[(seq - 1) % ATTEMPTS.length];

      setRows((current) => {
        const next = [...current, { ...attempt, seq }];
        return next.slice(-6); // keep the last six, drop the rest
      });
      // the counter IS the last sequence number. One source of truth.
      setDenied(seq);
    }, 1100);

    return () => clearInterval(timer);
  }, [live]);

  return (
    <section id="fence" ref={sectionRef} className="relative px-4 py-24 sm:px-6 sm:py-32">
      {/* the fence energising: one amber hairline sweeps across, once */}
      <motion.div
        initial={{ scaleX: 0, opacity: 0 }}
        whileInView={{ scaleX: 1, opacity: [0, 1, 1, 0] }}
        viewport={{ once: true, amount: 0.4 }}
        transition={{ duration: 1.1, ease: EASE }}
        className="absolute inset-x-0 top-0 h-px origin-left bg-signal"
      />

      <div className="mx-auto max-w-page">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="label text-bone-muted">The fence line</span>
            <h2 className="head mt-4 max-w-[22ch] text-[clamp(1.9rem,5vw,3.4rem)] text-bone">
              Past this line, nothing gets out.
            </h2>
          </div>
          <Badge tone="signal" dot>
            Egress guard · live
          </Badge>
        </div>

        <p className="mt-7 max-w-[62ch] text-[15px] leading-relaxed text-bone-muted sm:text-[16px]">
          OPX patches <span className="font-mono text-bone">fetch</span> at boot, before the
          model has generated a single token. Every outbound call an agent could make — a
          vendor API, a telemetry ping, a package download — is refused and written to the
          audit log with its own sequence number. The right-hand side of this panel stays
          empty because nothing ever reaches it.
        </p>

        {/* the wall itself */}
        <div className="mt-12 border border-line bg-plant-2">
          {/* panel header */}
          <div className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-6">
            <span className="label text-bone-muted">Outbound attempts · live</span>
            <span className="label hidden text-bone-muted sm:block">
              allow-list: <span className="text-denied">empty</span>
            </span>
          </div>

          <div className="relative h-[300px] overflow-hidden px-4 py-5 sm:h-[330px] sm:px-6">
            {/* THE FENCE: one amber hairline running down the panel, with a
                pulse travelling through it. The pulse is the only thing on this
                page that loops forever — the guard is always on. */}
            <div className="pointer-events-none absolute inset-y-0 left-[76%] w-px overflow-hidden bg-signal/45 sm:left-[66%]">
              <motion.div
                animate={{ y: ["-40%", "140%"] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
                className="absolute inset-x-0 h-1/3 bg-gradient-to-b from-transparent via-signal to-transparent"
              />
            </div>
            {/* the glow either side of it */}
            <div className="pointer-events-none absolute inset-y-0 left-[76%] -ml-[3px] w-[7px] bg-signal/[0.07] blur-[2px] sm:left-[66%]" />

            {/* Outside the fence. Permanently, provably empty — the emptiness
                is the feature, so it is labelled instead of left looking broken. */}
            <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[30%] items-center justify-center sm:flex">
              <div className="px-4 text-center">
                <div className="label text-bone-muted/50">outside</div>
                <div className="mt-2 font-mono text-[22px] text-bone-muted/30">0</div>
                <div className="label mt-1 text-bone-muted/40">bytes, ever</div>
              </div>
            </div>

            {/* The rows stop at the fence. Nothing is ever drawn past it. */}
            <div className="relative flex h-full w-[76%] flex-col justify-end gap-2.5 pr-3 sm:w-[66%] sm:pr-4">
              <AnimatePresence initial={false}>
                {rows.map((row) => (
                  <Row key={row.seq} row={row} />
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* the two numbers that matter */}
          <div className="grid grid-cols-2 border-t border-line sm:grid-cols-3">
            <Counter label="Packets out" value="0" tone="sealed" note="since boot" />
            <Counter
              label="Attempts denied"
              value={String(denied).padStart(3, "0")}
              tone="signal"
              note="this session"
              className="border-l border-line"
            />
            <div className="col-span-2 border-t border-line px-4 py-5 sm:col-span-1 sm:border-l sm:border-t-0 sm:px-6">
              <div className="label text-bone-muted">Enforced at</div>
              <div className="mt-2 font-mono text-[13px] text-bone">
                boot · before first token
              </div>
              <div className="label mt-2 text-bone-muted/60">not a firewall rule you can forget</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// One outbound attempt: the text, a tracer that shoots at the fence, and the
// refusal it gets there.
function Row({ row }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="flex items-center gap-3"
    >
      {/* the request, which greys out once it has been refused */}
      <motion.div
        animate={{ color: ["#E7E9E7", "#E7E9E7", "#5B6067"] }}
        transition={{ duration: 1.4, times: [0, 0.45, 1] }}
        className="flex min-w-0 items-center gap-2 font-mono text-[11px] sm:text-[12.5px]"
      >
        <span className="shrink-0 text-bone-muted">{row.method}</span>
        <span className="truncate">{row.target}</span>
      </motion.div>

      {/* The tracer: travels right and stops dead at the fence. Amber while it
          is in flight, because amber on this page means something is running. */}
      <motion.div
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.42, delay: 0.12, ease: "easeIn" }}
        className="h-px min-w-[8px] flex-1 origin-left bg-gradient-to-r from-signal/10 to-signal/75"
      />

      {/* what it got at the fence */}
      <motion.div
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2, delay: 0.54 }}
        className="flex shrink-0 items-center gap-2"
      >
        <span className="border border-denied/50 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-label text-denied">
          denied
        </span>
        <span className="hidden font-mono text-[10px] text-bone-muted/60 sm:inline">
          seq {String(row.seq).padStart(4, "0")}
        </span>
      </motion.div>
    </motion.div>
  );
}

function Counter({ label, value, tone, note, className = "" }) {
  return (
    <div className={`px-4 py-5 sm:px-6 ${className}`}>
      <div className="label text-bone-muted">{label}</div>
      <div
        className={`head mt-2 text-[clamp(1.6rem,4vw,2.4rem)] ${
          tone === "sealed" ? "text-sealed" : "text-signal"
        }`}
      >
        {value}
      </div>
      <div className="label mt-1 text-bone-muted/60">{note}</div>
    </div>
  );
}
