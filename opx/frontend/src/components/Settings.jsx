import { useEffect, useState } from "react";
import { ShieldCheck, WifiOff, Brain, CircleAlert, Cpu, KeyRound } from "lucide-react";
import Modal from "@/components/ui/modal";
import { Dot } from "@/components/ui/dot";

// Everything that used to crowd the sidebar now lives here, behind one button:
// the backend's live posture, the model registry, the API token, and a couple
// of small preferences. Opening this never changes what the workbench does — it
// just reports what OPX is right now and lets you set the token + preferences.

export default function Settings({ open, onClose, health, models, prefs, onPrefs }) {
  const reachable = health?.status === "ok";

  // token is kept in localStorage under "opx_token" (lib/api.js reads it). We
  // hold a local copy while the box is open and write on change.
  const [token, setToken] = useState("");
  useEffect(() => {
    if (open) setToken(localStorage.getItem("opx_token") ?? "");
  }, [open]);

  function saveToken(v) {
    setToken(v);
    if (v.trim()) localStorage.setItem("opx_token", v.trim());
    else localStorage.removeItem("opx_token");
  }

  return (
    <Modal open={open} onClose={onClose} title="Settings" width="38rem">
      {/* --- system posture ------------------------------------------------ */}
      <Section title="System">
        <div className="card divide-y divide-ink-line/70 overflow-hidden p-0">
          <Row icon={<Cpu size={13} />} label="Backend" value={reachable ? "reachable" : "degraded"} tone={reachable ? "sealed" : "denied"} />
          <Row icon={<Brain size={13} />} label="Memory" value={health?.memoryEnabled ? "on" : "off"} tone={health?.memoryEnabled ? "sealed" : "muted"} />
          <Row
            icon={health?.egressEnforced ? <WifiOff size={13} /> : <CircleAlert size={13} />}
            label="Egress"
            value={health?.egressEnforced ? "sealed" : "open"}
            tone={health?.egressEnforced ? "sealed" : "denied"}
          />
          <Row icon={<ShieldCheck size={13} />} label="Protocol" value={health?.protocol ?? "—"} tone="muted" />
        </div>
      </Section>

      {/* --- models -------------------------------------------------------- */}
      <Section title={`Models${models?.length ? ` · ${models.length}` : ""}`}>
        <div className="space-y-1.5">
          {(models ?? []).map((m) => (
            <ModelRow key={m.id} model={m} isDefault={m.id === health?.defaultModel} />
          ))}
          {(!models || models.length === 0) && (
            <p className="font-mono text-[11.5px] text-ink-muted/70">No models reported yet.</p>
          )}
        </div>
      </Section>

      {/* --- connection / token ------------------------------------------- */}
      <Section title="Connection">
        <label className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] text-ink-muted">
          <KeyRound size={12} /> API token
        </label>
        <input
          type="password"
          value={token}
          onChange={(e) => saveToken(e.target.value)}
          placeholder="only needed if the backend is not on loopback"
          className="w-full rounded-[10px] border border-ink-line bg-paper-2/50 px-3 py-2 font-mono text-[12px] text-ink placeholder:text-ink-muted/50 focus:border-ink/30 focus:outline-none"
        />
        <p className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-ink-muted/70">
          Sent as a Bearer token on every request. On a local demo (127.0.0.1) you can leave this blank.
        </p>
      </Section>

      {/* --- preferences --------------------------------------------------- */}
      <Section title="Preferences">
        <Toggle
          label="Open run details by default"
          hint="show each answer's guardrail + step trace without clicking"
          on={prefs.showTrace}
          onToggle={() => onPrefs({ ...prefs, showTrace: !prefs.showTrace })}
        />
      </Section>

      {/* --- about --------------------------------------------------------- */}
      <div className="mt-1 border-t border-ink-line pt-4">
        <p className="font-mono text-[10.5px] leading-relaxed text-ink-muted/70">
          OPX · local models only · nothing leaves the room.
        </p>
      </div>
    </Modal>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-5">
      <p className="label mb-2 text-ink-muted/70">{title}</p>
      {children}
    </div>
  );
}

function Row({ icon, label, value, tone }) {
  return (
    <div className="flex items-center gap-2.5 px-3 py-2.5">
      <span className="text-ink-muted/70">{icon}</span>
      <span className="font-mono text-[12px] text-ink">{label}</span>
      <span className="ml-auto flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink-muted">{value}</span>
        <Dot tone={tone} />
      </span>
    </div>
  );
}

// Same role colouring as the run trace, so a coder model reads differently from
// a vision model at a glance.
const ROLE_TONE = {
  reasoning: "text-node-logic",
  coding: "text-node-tool",
  vision: "text-node-model",
  document: "text-node-trigger",
  general: "text-ink-muted",
  multimodal: "text-node-model",
};

function ModelRow({ model, isDefault }) {
  return (
    <div className="card p-2.5">
      <div className="flex items-center gap-2">
        <span className="truncate font-mono text-[12px] text-ink">{model.id}</span>
        {isDefault && (
          <span className="label ml-auto shrink-0 rounded-[5px] border border-signal/40 px-1.5 py-0.5 text-[9px] text-signal">
            planner
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className={`label ${ROLE_TONE[model.role] ?? "text-ink-muted/70"}`}>{model.role}</span>
        <span className="ml-auto truncate font-mono text-[10px] text-ink-muted/60">{model.endpoint}</span>
      </div>
    </div>
  );
}

// A small pill switch. Amber when on — the same "this is live" amber used
// everywhere else.
function Toggle({ label, hint, on, onToggle }) {
  return (
    <button onClick={onToggle} className="flex w-full items-center gap-3 text-left">
      <span
        className={`relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors ${
          on ? "border-signal/50 bg-signal/25" : "border-ink-line bg-paper-2"
        }`}
      >
        <span
          className={`absolute top-1/2 h-[16px] w-[16px] -translate-y-1/2 rounded-full transition-all ${
            on ? "left-[19px] bg-signal" : "left-[2px] bg-ink-muted/50"
          }`}
        />
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-[12px] text-ink">{label}</span>
        {hint && <span className="block font-mono text-[10.5px] text-ink-muted/70">{hint}</span>}
      </span>
    </button>
  );
}
