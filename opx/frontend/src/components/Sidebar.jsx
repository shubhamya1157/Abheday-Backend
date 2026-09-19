import { Plus, Settings as SettingsIcon, MessageSquare, Folder, Trash2, PanelsTopLeft, Brain, Cpu, WifiOff, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ago, bucket } from "@/lib/store";

// The left rail — the whole app's navigation, the way Claude and GPT lay it
// out. Wordmark, a New chat button, your Projects, then your chat History
// grouped by day. Pinned at the bottom (the way Claude keeps status there) is
// the live system: planner model, memory, egress — then Settings, where the
// full model list lives.

export default function Sidebar({
  chats,
  projects,
  activeId,
  activeProjectId,
  view,
  health,
  busy,
  onNewChat,
  onOpenChat,
  onDeleteChat,
  onOpenProject,
  onNewProject,
  onOpenProjects,
  onOpenSettings,
}) {
  const reachable = health?.status === "ok";

  // only real chats (with messages), newest first, then split into day buckets
  const recents = chats
    .filter((c) => c.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const groups = groupByDay(recents);

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-ink-line bg-paper-2/40">
      {/* header */}
      <div className="flex items-center gap-2.5 px-5 py-4">
        <span className="wordmark text-[18px] text-ink">
          OP<span className="text-signal">X</span>
        </span>
      </div>

      {/* new chat */}
      <div className="px-3">
        <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => onNewChat(null)} disabled={busy}>
          <Plus size={14} /> New chat
        </Button>
      </div>

      {/* scrolling middle: projects, then history */}
      <div className="mt-4 flex-1 overflow-y-auto px-3 pb-4">
        {/* projects */}
        <div className="mb-1 flex items-center justify-between px-2">
          <button
            onClick={onOpenProjects}
            className={`label transition-colors hover:text-ink ${view === "projects" ? "text-ink" : "text-ink-muted/60"}`}
          >
            Projects
          </button>
          <button onClick={onNewProject} title="New project" className="text-ink-muted/60 transition-colors hover:text-ink">
            <Plus size={13} />
          </button>
        </div>
        <div className="mb-5 space-y-0.5">
          {projects.map((p) => {
            const active = view === "project" && activeProjectId === p.id;
            return (
              <button
                key={p.id}
                onClick={() => onOpenProject(p.id)}
                className={`flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left transition-colors ${
                  active ? "bg-ink/[0.06] text-ink" : "text-ink hover:bg-ink/[0.03]"
                }`}
              >
                <Folder size={13} className="shrink-0 text-ink-muted/70" />
                <span className="truncate text-[13px]">{p.name}</span>
              </button>
            );
          })}
          {projects.length === 0 && (
            <button
              onClick={onNewProject}
              className="flex w-full items-center gap-2 rounded-[8px] px-2 py-1.5 font-mono text-[11.5px] text-ink-muted/70 hover:text-ink"
            >
              <PanelsTopLeft size={13} /> Group chats into a project
            </button>
          )}
        </div>

        {/* history, grouped by day */}
        <p className="label mb-1 px-2 text-ink-muted/60">History</p>
        {groups.map((g) => (
          <div key={g.name} className="mb-3">
            <p className="px-2 py-1 font-mono text-[10px] uppercase tracking-label text-ink-muted/45">{g.name}</p>
            <div className="space-y-0.5">
              {g.items.map((c) => (
                <ChatRow
                  key={c.id}
                  chat={c}
                  active={view === "chat" && c.id === activeId}
                  onOpen={() => onOpenChat(c.id)}
                  onDelete={() => onDeleteChat(c.id)}
                />
              ))}
            </div>
          </div>
        ))}
        {recents.length === 0 && (
          <p className="px-2 py-2 font-mono text-[11.5px] text-ink-muted/60">No chats yet.</p>
        )}
      </div>

      {/* footer: the live system, the way Claude keeps its status pinned at the
          bottom — planner model, memory, egress — then Settings underneath */}
      <div className="border-t border-ink-line px-3 py-2.5">
        <div className="mb-1 space-y-0.5">
          <StatusRow
            icon={<Cpu size={13} />}
            label="Planner"
            value={health?.defaultModel ?? (reachable ? "ready" : "—")}
            tone={reachable ? "model" : "muted"}
          />
          <StatusRow
            icon={<Brain size={13} />}
            label="Memory"
            value={health?.memoryEnabled ? "on" : "off"}
            tone={health?.memoryEnabled ? "sealed" : "muted"}
          />
          <StatusRow
            icon={health?.egressEnforced ? <WifiOff size={13} /> : <CircleAlert size={13} />}
            label="Egress"
            value={health?.egressEnforced ? "sealed" : "open"}
            tone={health?.egressEnforced ? "sealed" : "denied"}
            live={busy}
          />
        </div>

        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2.5 rounded-[8px] px-2 py-2 text-left text-ink transition-colors hover:bg-ink/[0.04]"
        >
          <SettingsIcon size={14} className="text-ink-muted/70" />
          <span className="text-[13px]">Settings</span>
        </button>
      </div>
    </aside>
  );
}

// one line in the bottom status block: an icon, a label, the value, and a small
// coloured dot. Same colour language as the run trace (violet = the model).
const STATUS_DOT = {
  model: "bg-node-model",
  sealed: "bg-sealed",
  denied: "bg-denied",
  muted: "bg-ink-muted/50",
};

function StatusRow({ icon, label, value, tone, live }) {
  return (
    <div className="flex items-center gap-2.5 rounded-[8px] px-2 py-1">
      <span className="text-ink-muted/70">{icon}</span>
      <span className="font-mono text-[11.5px] text-ink">{label}</span>
      <span className="ml-auto flex items-center gap-1.5">
        <span className="max-w-[92px] truncate font-mono text-[10.5px] text-ink-muted">{value}</span>
        <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[tone] ?? STATUS_DOT.muted} ${live ? "animate-breathe" : ""}`} />
      </span>
    </div>
  );
}

// one row in the history list
function ChatRow({ chat, active, onOpen, onDelete }) {
  return (
    <div
      className={`group flex items-center gap-2.5 rounded-[8px] px-2 py-1.5 transition-colors ${
        active ? "bg-ink/[0.06]" : "hover:bg-ink/[0.03]"
      }`}
    >
      <MessageSquare size={13} className="shrink-0 text-ink-muted/70" />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px] text-ink">{chat.title}</span>
      </button>
      <span className="shrink-0 font-mono text-[9.5px] text-ink-muted/50 group-hover:hidden">{ago(chat.updatedAt)}</span>
      <button
        onClick={onDelete}
        title="Delete chat"
        className="hidden shrink-0 group-hover:block"
      >
        <Trash2 size={13} className="text-ink-muted/60 hover:text-denied" />
      </button>
    </div>
  );
}

// split a newest-first list into Today / Yesterday / Previous, dropping empty
// buckets so the sidebar never shows a header with nothing under it
function groupByDay(list) {
  const order = ["Today", "Yesterday", "Previous"];
  const map = { Today: [], Yesterday: [], Previous: [] };
  for (const c of list) map[bucket(c.updatedAt)].push(c);
  return order.filter((name) => map[name].length > 0).map((name) => ({ name, items: map[name] }));
}
