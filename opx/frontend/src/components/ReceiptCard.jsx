import { useState } from "react";
import { ShieldCheck, ShieldAlert, FileText, Download, RefreshCw } from "lucide-react";
import { verifyReceipt, renderReceipt } from "@/lib/api";
import { download } from "@/lib/utils";

// The Trust Receipt, made real. Given the full receipt the backend built for a
// run, this shows what happened (steps, tools, guard actions, egress) and lets
// you do the three things the receipt exists for:
//   • Verify  — ask the backend to independently re-check the ordering. This is
//               the point of the receipt: you can hand it back and confirm it.
//   • Markdown — render the human-readable report (POST /receipt/render).
//   • Download — save it as JSON or Markdown, the artifact you keep.
//
// Used under each answer and inside the Inspect view, so both look the same.

export default function ReceiptCard({ receipt }) {
  const [verify, setVerify] = useState(null); // null | "checking" | result
  const [markdown, setMarkdown] = useState(null); // null | "loading" | text
  const [error, setError] = useState("");

  if (!receipt || !Array.isArray(receipt.entries)) {
    return <p className="font-mono text-[11.5px] text-ink-muted/70">No receipt to show.</p>;
  }

  const stats = receipt.stats ?? {};
  const eg = receipt.egress;

  async function onVerify() {
    setVerify("checking");
    setError("");
    try {
      const result = await verifyReceipt(receipt);
      setVerify(result);
    } catch (err) {
      setVerify(null);
      setError(err.message);
    }
  }

  async function onMarkdown() {
    if (markdown && markdown !== "loading") {
      setMarkdown(null); // second click hides it
      return;
    }
    setMarkdown("loading");
    setError("");
    try {
      const text = await renderReceipt(receipt);
      setMarkdown(text);
    } catch (err) {
      setMarkdown(null);
      setError(err.message);
    }
  }

  function onDownloadJson() {
    download(`${receipt.runId}.json`, JSON.stringify(receipt, null, 2), "application/json");
  }

  async function onDownloadMd() {
    try {
      const text = markdown && markdown !== "loading" ? markdown : await renderReceipt(receipt);
      download(`${receipt.runId}.md`, text, "text/markdown");
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card p-3">
      {/* what happened, in one readable row of small counts */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Stat label="steps" value={stats.steps ?? 0} />
        <Stat label="tool calls" value={stats.toolCalls ?? 0} />
        <Stat label="blocks" value={stats.guardrailBlocks ?? 0} tone={stats.guardrailBlocks ? "denied" : undefined} />
        <Stat label="sanitised" value={stats.guardrailSanitizations ?? 0} />
        <Stat label="events" value={receipt.entries.length} />
        {eg && (
          <Stat
            label="egress"
            value={eg.enforced ? `sealed · ${eg.blockedRequests} refused` : "open"}
            tone={eg.enforced ? "sealed" : "denied"}
          />
        )}
      </div>

      {/* which tools were used + which paths were touched, if any */}
      {stats.toolsUsed && Object.keys(stats.toolsUsed).length > 0 && (
        <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-ink-muted">
          tools:{" "}
          {Object.entries(stats.toolsUsed)
            .map(([n, c]) => `${n}×${c}`)
            .join("  ")}
        </p>
      )}
      {stats.pathsTouched && stats.pathsTouched.length > 0 && (
        <p className="mt-1 break-words font-mono text-[10.5px] leading-relaxed text-ink-muted">
          paths: {stats.pathsTouched.join("  ")}
        </p>
      )}

      {/* the three actions the receipt exists for */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Action onClick={onVerify} icon={<RefreshCw size={12} className={verify === "checking" ? "animate-spin" : ""} />}>
          {verify === "checking" ? "verifying…" : "verify"}
        </Action>
        <Action onClick={onMarkdown} icon={<FileText size={12} />}>
          {markdown && markdown !== "loading" ? "hide report" : markdown === "loading" ? "loading…" : "markdown"}
        </Action>
        <Action onClick={onDownloadJson} icon={<Download size={12} />}>
          json
        </Action>
        <Action onClick={onDownloadMd} icon={<Download size={12} />}>
          .md
        </Action>
      </div>

      {/* the independent verify result — the trust boundary, confirmed */}
      {verify && verify !== "checking" && (
        <div
          className={
            "mt-2.5 flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 font-mono text-[11px] " +
            (verify.valid
              ? "border-sealed/40 bg-sealed/[0.08] text-[#1F8A4C]"
              : "border-denied/40 bg-denied/[0.06] text-denied")
          }
        >
          {verify.valid ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
          {verify.valid
            ? `sequence intact · ${verify.entriesChecked} entries checked`
            : `broken at #${verify.brokenAt} · ${verify.reason}`}
        </div>
      )}

      {error && <p className="mt-2 font-mono text-[10.5px] text-denied">{error}</p>}

      {/* the rendered Markdown report, shown inline when asked for */}
      {markdown && markdown !== "loading" && (
        <pre className="mt-2.5 max-h-[420px] overflow-auto rounded-[8px] border border-ink-line bg-paper px-3 py-2.5 font-mono text-[11px] leading-relaxed text-ink">
          {markdown}
        </pre>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === "denied" ? "text-denied" : tone === "sealed" ? "text-[#1F8A4C]" : "text-ink";
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={`font-mono text-[13px] font-medium ${color}`}>{value}</span>
      <span className="label text-ink-muted/70">{label}</span>
    </span>
  );
}

function Action({ onClick, icon, children }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-[8px] border border-ink-line px-2.5 py-1 font-mono text-[11px] text-ink-muted transition-colors hover:border-ink/30 hover:text-ink"
    >
      {icon}
      {children}
    </button>
  );
}
