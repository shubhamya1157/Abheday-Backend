import { useEffect } from "react";
import { X } from "lucide-react";

// A plain centered dialog on a dimmed page. Click the backdrop or press Esc to
// close. Nothing fancy — one paper panel with a hairline border and a title
// row, so Settings and the new-project box look like they came out of the same
// cabinet as everything else.

export default function Modal({ open, onClose, title, children, width = "34rem" }) {
  // close on Esc while the dialog is open
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-[8vh] backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full rounded-[16px] border border-ink-line bg-paper shadow-[0_20px_60px_rgba(11,12,11,0.18)]"
        style={{ maxWidth: width }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-ink-line px-5 py-3.5">
          <span className="label text-ink-muted">{title}</span>
          <button
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-[8px] text-ink-muted transition-colors hover:bg-ink/[0.05] hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  );
}
