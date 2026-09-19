import { Plus, Trash2, MessageSquare, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ago } from "@/lib/store";

// One project, opened. A project is just a folder of chats plus standing
// instructions that get sent ahead of every chat inside it — so you can set the
// context once ("you are reviewing my thesis, cite page numbers") and every
// chat here inherits it. The header name and the instructions are editable in
// place; below them is the list of chats that belong to this project.

export default function ProjectView({ project, chats, onOpenChat, onNewChat, onRename, onInstructions, onDeleteChat, onDeleteProject }) {
  // only the chats that have actually been used (have messages) are worth
  // showing, newest first
  const list = chats
    .filter((c) => c.projectId === project.id && c.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="mx-auto w-full max-w-[46rem] px-5 py-10">
      <div className="mb-1 flex items-center gap-2 text-ink-muted">
        <FolderOpen size={15} />
        <span className="label">Project</span>
      </div>

      {/* name — click to edit, plain contentEditable-free input */}
      <input
        value={project.name}
        onChange={(e) => onRename(project.id, e.target.value)}
        className="w-full bg-transparent font-display text-[28px] font-semibold text-ink focus:outline-none"
      />

      {/* standing instructions for every chat in this project */}
      <div className="card mt-5 p-4">
        <p className="label mb-2 text-ink-muted/70">Project instructions</p>
        <textarea
          value={project.instructions}
          onChange={(e) => onInstructions(project.id, e.target.value)}
          rows={3}
          placeholder="Standing context for every chat in this project — a role, a format, files to keep in mind…"
          className="w-full resize-none bg-transparent font-sans text-[14px] leading-relaxed text-ink placeholder:text-ink-muted/50 focus:outline-none"
        />
      </div>

      {/* the project's chats */}
      <div className="mb-3 mt-8 flex items-center justify-between">
        <p className="label text-ink-muted/70">
          Chats {list.length ? `· ${list.length}` : ""}
        </p>
        <Button variant="outline" size="sm" onClick={() => onNewChat(project.id)}>
          <Plus size={14} /> New chat
        </Button>
      </div>

      <div className="space-y-1.5">
        {list.map((c) => (
          <div key={c.id} className="card group flex items-center gap-3 p-3 transition-colors hover:border-ink/25">
            <MessageSquare size={14} className="shrink-0 text-ink-muted/70" />
            <button onClick={() => onOpenChat(c.id)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[14px] text-ink">{c.title}</span>
              <span className="block font-mono text-[10.5px] text-ink-muted/70">
                {c.messages.length} messages · {ago(c.updatedAt)}
              </span>
            </button>
            <button
              onClick={() => onDeleteChat(c.id)}
              title="Delete this chat"
              className="opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2 size={14} className="text-ink-muted/60 hover:text-denied" />
            </button>
          </div>
        ))}

        {list.length === 0 && (
          <p className="py-6 text-center font-mono text-[12px] text-ink-muted/70">
            No chats yet. Start one and it stays in this project.
          </p>
        )}
      </div>

      <div className="mt-10 border-t border-ink-line pt-4">
        <button
          onClick={() => onDeleteProject(project.id)}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink-muted/70 transition-colors hover:text-denied"
        >
          <Trash2 size={12} /> Delete project
        </button>
      </div>
    </div>
  );
}
