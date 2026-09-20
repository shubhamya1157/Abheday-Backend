import { useEffect, useState } from "react";
import { Wrench, FileText, ReceiptText, Copy, Download, Upload } from "lucide-react";
import { getTools, getSystemPrompt } from "@/lib/api";
import { download } from "@/lib/utils";
import ReceiptCard from "@/components/ReceiptCard";

// The Inspect view — everything the backend can show about itself, in one place.
// Three tabs, each backed by a real endpoint:
//   • Tools         GET /tools          — the catalogue the model is given
//   • System prompt GET /system-prompt  — the exact instructions, nothing hidden
//   • Receipt       POST /receipt/*     — load any receipt and verify/render it
//
// This is the "nothing is hidden" half of OPX: the chat shows what it answered,
// Inspect shows how it was set up and lets you audit any run after the fact.

export default function Inspect() {
  const [tab, setTab] = useState("tools");

  return (
    <div className="mx-auto flex h-full w-full max-w-[52rem] flex-col px-6 py-10">
      <div className="mb-5">
        <h1 className="font-display text-[26px] font-semibold text-ink">Inspect</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          What the model is given, and how any run can be verified. Straight from the backend.
        </p>
      </div>

      {/* tabs */}
      <div className="mb-5 flex gap-1.5">
        <Tab active={tab === "tools"} onClick={() => setTab("tools")} icon={<Wrench size={13} />}>
          Tools
        </Tab>
        <Tab active={tab === "prompt"} onClick={() => setTab("prompt")} icon={<FileText size={13} />}>
          System prompt
        </Tab>
        <Tab active={tab === "receipt"} onClick={() => setTab("receipt")} icon={<ReceiptText size={13} />}>
          Receipt
        </Tab>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "tools" && <ToolsTab />}
        {tab === "prompt" && <PromptTab />}
        {tab === "receipt" && <ReceiptTab />}
      </div>
    </div>
  );
}

function Tab({ active, onClick, icon, children }) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-2 rounded-[10px] border px-3 py-1.5 font-mono text-[12px] transition-colors " +
        (active
          ? "border-ink/25 bg-ink/[0.05] text-ink"
          : "border-transparent text-ink-muted hover:bg-ink/[0.03] hover:text-ink")
      }
    >
      {icon}
      {children}
    </button>
  );
}

/* --- Tools ---------------------------------------------------------------- */

function ToolsTab() {
  const [tools, setTools] = useState(null); // null = loading
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    getTools()
      .then((r) => alive && setTools(r.tools ?? []))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <Note>Could not load tools: {error}</Note>;
  if (!tools) return <Note>Loading tools…</Note>;
  if (tools.length === 0) return <Note>No tools are registered.</Note>;

  return (
    <div className="space-y-2">
      <p className="label mb-1 text-ink-muted/70">{tools.length} tools the model can call</p>
      {tools.map((t) => (
        <ToolRow key={t.name} tool={t} />
      ))}
    </div>
  );
}

// One tool: its name, tier, one-line description, and (folded away) the exact
// parameters the model must fill in.
function ToolRow({ tool }) {
  const [open, setOpen] = useState(false);
  const props = tool.parameters?.properties ?? {};
  const required = new Set(tool.parameters?.required ?? []);
  const paramNames = Object.keys(props);

  return (
    <div className="card p-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[13px] text-ink">{tool.name}</span>
        {tool.tier && (
          <span className="label rounded-[5px] border border-ink-line px-1.5 py-0.5 text-[9px] text-ink-muted">
            {tool.tier}
          </span>
        )}
        {paramNames.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto font-mono text-[11px] text-ink-muted transition-colors hover:text-ink"
          >
            {open ? "hide params" : `${paramNames.length} params`}
          </button>
        )}
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-muted">{tool.description}</p>

      {open && paramNames.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-ink-line pt-2">
          {paramNames.map((name) => (
            <li key={name} className="flex items-baseline gap-2">
              <span className="font-mono text-[11.5px] text-ink">{name}</span>
              <span className="font-mono text-[10.5px] text-ink-muted/70">{props[name]?.type ?? "any"}</span>
              {required.has(name) && <span className="label text-[9px] text-signal">required</span>}
              {props[name]?.description && (
                <span className="truncate font-mono text-[10.5px] text-ink-muted/70">— {props[name].description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --- System prompt -------------------------------------------------------- */

function PromptTab() {
  const [text, setText] = useState(null); // null = loading
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getSystemPrompt()
      .then((t) => alive && setText(t))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, []);

  function onCopy() {
    navigator.clipboard?.writeText(text ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  if (error) return <Note>Could not load the system prompt: {error}</Note>;
  if (text === null) return <Note>Loading system prompt…</Note>;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <p className="label text-ink-muted/70">{text.length.toLocaleString()} characters · contains no secrets</p>
        <div className="ml-auto flex gap-2">
          <SmallBtn onClick={onCopy} icon={<Copy size={12} />}>
            {copied ? "copied" : "copy"}
          </SmallBtn>
          <SmallBtn onClick={() => download("system-prompt.txt", text)} icon={<Download size={12} />}>
            save
          </SmallBtn>
        </div>
      </div>
      <pre className="max-h-[62vh] overflow-auto rounded-[12px] border border-ink-line bg-paper-2/50 px-4 py-3 font-mono text-[12px] leading-relaxed text-ink">
        {text}
      </pre>
    </div>
  );
}

/* --- Receipt -------------------------------------------------------------- */

// Load any receipt the backend wrote (from its audit folder, e.g.
// <runId>.json) and audit it here. This is the "hand a receipt back and confirm
// it" story: nothing about the receipt trusts the UI — Verify and Markdown both
// go to the backend.
function ReceiptTab() {
  const [receipt, setReceipt] = useState(null);
  const [error, setError] = useState("");

  function loadText(raw) {
    setError("");
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.entries)) {
        setError("That JSON is not a receipt — it has no entries array.");
        setReceipt(null);
        return;
      }
      setReceipt(parsed);
    } catch (e) {
      setError("Could not parse that as JSON: " + e.message);
      setReceipt(null);
    }
  }

  function onFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadText(String(reader.result));
    reader.readAsText(file);
  }

  return (
    <div>
      <p className="mb-2 text-[13px] leading-relaxed text-ink-muted">
        Paste a receipt, or load one the backend saved (its audit folder writes{" "}
        <span className="font-mono text-[12px] text-ink">{"<runId>.json"}</span>). It gets verified and rendered by the
        backend, not here.
      </p>

      <div className="mb-2 flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-ink-line px-2.5 py-1 font-mono text-[11px] text-ink-muted transition-colors hover:border-ink/30 hover:text-ink">
          <Upload size={12} /> load .json
          <input type="file" accept="application/json,.json" onChange={onFile} className="hidden" />
        </label>
        {receipt && (
          <span className="font-mono text-[11px] text-ink-muted">
            run <span className="text-ink">{receipt.runId}</span>
          </span>
        )}
      </div>

      <textarea
        rows={5}
        placeholder='{ "runId": "…", "entries": [ … ] }'
        onChange={(e) => e.target.value.trim() && loadText(e.target.value)}
        className="w-full resize-y rounded-[12px] border border-ink-line bg-paper-2/50 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink placeholder:text-ink-muted/50 focus:border-ink/30 focus:outline-none"
      />

      {error && <p className="mt-2 font-mono text-[11px] text-denied">{error}</p>}

      {receipt && (
        <div className="mt-3">
          <ReceiptCard receipt={receipt} />
        </div>
      )}
    </div>
  );
}

/* --- little shared bits --------------------------------------------------- */

function Note({ children }) {
  return <p className="font-mono text-[12px] text-ink-muted/80">{children}</p>;
}

function SmallBtn({ onClick, icon, children }) {
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
