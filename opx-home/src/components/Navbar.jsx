import { motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// The floating navbar: wordmark, the two links, Enter.
//
// Corners are squared off but not sharp, so it reads like the bezel on a
// control panel rather than a pill. It repaints itself when the page cuts from
// the office to the machine room.

const links = [
  { label: "How it works", href: "#how-it-works" },
  { label: "Features", href: "#features" },
];

export default function Navbar({ dark }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -14 }}
      animate={{ opacity: 1, y: 0 }}
      // arrives late, after the punch line has landed
      transition={{ duration: 0.7, delay: 1.4, ease: [0.2, 0.8, 0.2, 1] }}
      className="fixed inset-x-0 top-0 z-50 px-4 pt-4 sm:px-6 sm:pt-6"
    >
      <nav
        className={cn(
          "relative mx-auto flex h-14 max-w-page items-center justify-between rounded-[13px] border px-3 backdrop-blur-xl transition-colors duration-cut sm:px-4",
          dark ? "border-line bg-plant/90" : "border-ink/15 bg-paper/90"
        )}
      >
        {/* the wordmark. Its own typeface, and the X carries the accent. */}
        <a href="#top" className="group pl-1.5">
          <span className="wordmark text-[21px] leading-none">
            OP
            <span className="text-signal transition-opacity duration-200 group-hover:opacity-70">
              X
            </span>
          </span>
        </a>

        {/* The two page links, each its own button with air between them, so
            they read as two separate places to go rather than one segmented
            control. Same 9px corner as Enter. */}
        <div className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 md:flex">
          {links.map((link) => (
            <Button
              key={link.href}
              as="a"
              href={link.href}
              size="sm"
              variant={dark ? "outline" : "outlinePaper"}
              className="rounded-[9px] px-4"
            >
              {link.label}
            </Button>
          ))}
        </div>

        {/* right side: the way in. Amber, because it is the same X. */}
        <div className="flex items-center gap-3">
          <Button as="a" href="#enter" size="sm" variant="enter" className="rounded-[9px] px-5">
            Enter
          </Button>
        </div>
      </nav>
    </motion.header>
  );
}
