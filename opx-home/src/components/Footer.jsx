import { motion } from "motion/react";
import { Button } from "@/components/ui/button";

// The closer. Two jobs: say the one thing that actually proves the product,
// then get out of the way. One amber hairline across the very bottom of the
// page has the last word, and nothing comes after it.

const EASE = [0.16, 1, 0.3, 1];

const PAGE_LINKS = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
];

// Statements, not links. Every one of these can be checked on the machine
// in the room, which is the only reason to print them. The egress claim used
// to live here too — it moved down to the plate, so it is not said twice.
const FACTS = [
  "Open weights only",
  "Runs on hardware you own",
  "Text artifacts today",
];

export default function Footer() {
  return (
    <footer id="enter" className="relative overflow-hidden px-4 pb-0 pt-24 sm:px-6 sm:pt-32">
      <div className="mx-auto max-w-page">
        <div className="mt-20 grid gap-4 border-t border-line py-7 sm:grid-cols-3 sm:items-center">
          <span className="wordmark text-[19px] leading-none text-bone">
            OP<span className="text-signal">X</span>
          </span>

          <span className="label text-left text-bone-muted/60 sm:text-center">
            Built by <span className="text-bone">Team CodeBlooded</span>
          </span>

          <span className="label flex items-center gap-2.5 text-bone-muted sm:justify-end">
            {/* green, because this is the one line on the plate you can verify */}
          
            No external API calls!
          </span>
        </div>
      </div>

    </footer>
  );
}
