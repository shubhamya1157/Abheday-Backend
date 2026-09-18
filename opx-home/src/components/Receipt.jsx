import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/ui/badge";

// Every artifact leaves with a tag stapled to it. This is that tag.
//
// Careful with the wording here: the receipt is ORDERED and GAP-CHECKED.
// It is not hashed and it is not a chain, so never call it tamper-proof.
// The small print at the bottom says exactly what it is, which is the whole
// reason anyone should believe the rest of the page.

const FIELDS = [
  { key: "Artifact", value: "NS-PSV-2103A.md", extra: "612 words" },
  { key: "Model", value: "gemma-3-1b-it", extra: "open weights · local" },
  { key: "Tools run", value: "read_file, write_file", extra: "2 calls" },
  { key: "Events", value: "12", extra: "seq 1…12 · gaps 0" },
  { key: "Egress", value: "0 bytes", extra: "0 calls allowed" },
];

export default function Receipt({ visible }) {
  return (
    <div className="mt-10">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="border border-line bg-plant-2"
          >
            {/* tear line, like the perforated edge of a paper tag */}
            <div className="border-t border-dashed border-bone-muted/25" />

            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4 sm:px-7">
              <span className="label text-bone-muted">Trust receipt</span>
              <Badge tone="sealed" dot>
                Sealed · zero egress
              </Badge>
            </div>

            <dl className="border-t border-line">
              {FIELDS.map((field, i) => (
                <motion.div
                  key={field.key}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.3, delay: 0.12 + i * 0.07 }}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-line px-5 py-3.5 last:border-b-0 sm:px-7"
                >
                  <dt className="label w-28 shrink-0 text-bone-muted">{field.key}</dt>
                  <dd className="font-mono text-[13px] text-bone">{field.value}</dd>
                  <dd className="label ml-auto text-bone-muted/60">{field.extra}</dd>
                </motion.div>
              ))}
            </dl>

            {/* the honest small print. Leave it in. */}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.55 }}
              className="max-w-[70ch] px-5 py-5 text-[12.5px] leading-relaxed text-bone-muted/70 sm:px-7"
            >
              Ordered and gap-checked — not a hash chain, and not signed.{" "}
              <span className="font-mono text-bone-muted">verifyReceipt()</span> walks the
              sequence and names the exact index where it breaks. No keys to manage, and
              nothing here you cannot read yourself.
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
