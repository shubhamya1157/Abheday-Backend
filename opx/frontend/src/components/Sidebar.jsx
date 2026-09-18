import { Plus, ShieldCheck, WifiOff, Brain, CircleAlert, Cpu } from "lucide-react";
import { Dot } from "@/components/ui/dot";
import { Button } from "@/components/ui/button";

// The left rail, kept quiet. The wordmark, a New chat button, then two small
// readouts of the backend's real state (its posture and its models) — read from
// /health and /models, so this rail reports what OPX actually is right now, it
// is not decoration. A thin ink hairline separates it from the conversation.

export default function Sidebar({ health, models, onNewSession, busy }) {
  const reachable = health?.status === "ok";

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-ink-line bg-paper-2/40">
      <div className="flex items-center gap-2.5 px-5 py-4">
        <span className="wordmark text-[18px] text-ink">
          OP<span className="text-signal">X</span>
        </span>
        <span className="label text-ink-muted/70">workbench</span>
      </div>

      <div className="px-3">
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={onNewSession} disabled={busy}>
          <Plus size={14} /> New chat
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-5">
        {/* backend posture */}
        <p className="label mb-2 px-2 text-ink-muted/60">System</p>
        <div className="space-y-0.5">
          <Posture
            icon={<Cpu size={13} />}
            label="Backend"
            value={reachable ? "reachable" : "degraded"}
            tone={reachable ? "sealed" : "denied"}
            live={busy}
          />
          <Posture
            icon={<Brain size={13} />}
            label="Memory"
            value={health?.memoryEnabled ? "on" : "off"}
            tone={health?.memoryEnabled ? "sealed" : "muted"}
          />
          <Posture
            icon={health?.egressEnforced ? <WifiOff size={13} /> : <CircleAlert size={13} />}
            label="Egress"
            value={health?.egressEnforced ? "sealed" : "open"}
            tone={health?.egressEnforced ? "sealed" : "denied"}
          />
          <Posture
            icon={<ShieldCheck size={13} />}
            label="Protocol"
            value={health?.protocol ?? "—"}
            tone="muted"
          />
        </div>

        {/* models */}
        <p className="label mb-2 mt-6 px-2 text-ink-muted/60">
          Models {models?.length ? `· ${models.length}` : ""}
        </p>
        <div className="space-y-1">
          {(models ?? []).map((m) => (
            <ModelRow key={m.id} model={m} isDefault={m.id === health?.defaultModel} />
          ))}
          {(!models || models.length === 0) && (
            <p className="px-2 font-mono text-[11.5px] text-ink-muted/70">No models reported yet.</p>
          )}
        </div>
      </div>

      <div className="border-t border-ink-line px-5 py-3.5">
        <p className="font-mono text-[10px] leading-relaxed text-ink-muted/70">
          Local models only. Nothing leaves the room.
        </p>
      </div>
    </aside>
  );
}

function Posture({ icon, label, value, tone, live }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[8px] px-2 py-1.5">
      <span className="text-ink-muted/70">{icon}</span>
      <span className="font-mono text-[12px] text-ink">{label}</span>
      <span className="ml-auto flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink-muted">{value}</span>
        <Dot tone={tone} live={live} />
      </span>
    </div>
  );
}

// One model. Role coloured by the node palette so a coder reads differently
// from a vision model at a glance — the same colour language as the run steps.
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
    <div className="rounded-[9px] px-2 py-1.5 hover:bg-ink/[0.03]">
      <div className="flex items-center gap-2">
        <span className="truncate font-mono text-[12px] text-ink">{model.id}</span>
        {isDefault && (
          <span className="label ml-auto shrink-0 rounded-[5px] border border-signal/40 px-1.5 py-0.5 text-[9px] text-signal">
            planner
          </span>
        )}
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className={`label ${ROLE_TONE[model.role] ?? "text-ink-muted/70"}`}>{model.role}</span>
        <span className="ml-auto truncate font-mono text-[10px] text-ink-muted/60">{model.endpoint}</span>
      </div>
    </div>
  );
}
