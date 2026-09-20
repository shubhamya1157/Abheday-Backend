import { useEffect, useState, useRef } from "react";
import { Plus, Folder, ArrowRight } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import Message from "@/components/Message";
import Composer from "@/components/Composer";
import Settings from "@/components/Settings";
import ProjectView from "@/components/ProjectView";
import Inspect from "@/components/Inspect";
import Modal from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { getHealth, getModels, chatStream } from "@/lib/api";
import {
  blankChat,
  blankProject,
  loadChats,
  saveChats,
  loadProjects,
  saveProjects,
  loadPrefs,
  savePrefs,
  titleFrom,
  ago,
} from "@/lib/store";

// The whole app shell, laid out like Claude/GPT: a nav rail on the left, one
// working area on the right. The working area shows one of three things — a
// chat, the grid of projects, or a single project — and Settings opens over the
// top of any of them. Chats and projects are kept in the browser (see
// lib/store.js), so History and Projects survive a refresh; the model run
// itself still streams live from the backend.

export default function App() {
  // persisted collections
  const [chats, setChats] = useState(() => loadChats());
  const [projects, setProjects] = useState(() => loadProjects());
  const [prefs, setPrefs] = useState(() => loadPrefs());

  // what is on screen right now
  const [view, setView] = useState("chat"); // "chat" | "projects" | "project" | "inspect"
  const [activeId, setActiveId] = useState(() => firstChatId(loadChats()));
  const [activeProjectId, setActiveProjectId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjName, setNewProjName] = useState("");

  // chat runtime
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(null);
  const [models, setModels] = useState([]);

  const stopRef = useRef(null);
  const threadRef = useRef(null);

  // save collections whenever they change
  useEffect(() => saveChats(chats), [chats]);
  useEffect(() => saveProjects(projects), [projects]);
  useEffect(() => savePrefs(prefs), [prefs]);

  // load backend posture on mount, keep it fresh every 15s
  useEffect(() => {
    let alive = true;
    async function refresh() {
      try {
        const [h, m] = await Promise.all([getHealth(), getModels()]);
        if (!alive) return;
        setHealth(h);
        setModels(m.models ?? []);
      } catch {
        if (alive) setHealth({ status: "degraded" });
      }
    }
    refresh();
    const t = setInterval(refresh, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const activeChat = chats.find((c) => c.id === activeId) ?? null;
  const messages = activeChat?.messages ?? [];
  const empty = messages.length === 0;

  // keep the newest message in view while on a chat
  useEffect(() => {
    if (view === "chat") {
      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages, view]);

  // --- navigation ----------------------------------------------------------

  function openChat(id) {
    setActiveId(id);
    setView("chat");
  }

  // Start a fresh chat. If the current chat is already blank, reuse it instead
  // of piling up empties — same feel as the apps.
  function newChat(projectId = null) {
    if (busy) return;
    if (activeChat && activeChat.messages.length === 0) {
      setChats((prev) => prev.map((c) => (c.id === activeChat.id ? { ...c, projectId } : c)));
      setView("chat");
      return;
    }
    const chat = blankChat(projectId);
    setChats((prev) => [chat, ...prev]);
    setActiveId(chat.id);
    setView("chat");
  }

  function deleteChat(id) {
    setChats((prev) => prev.filter((c) => c.id !== id));
    if (id === activeId) {
      setActiveId(null);
      setView("chat");
    }
  }

  function openProjects() {
    setView("projects");
  }

  function openInspect() {
    setView("inspect");
  }

  function openProject(id) {
    setActiveProjectId(id);
    setView("project");
  }

  function createProject() {
    const name = newProjName.trim() || "Untitled project";
    const p = blankProject(name);
    setProjects((prev) => [p, ...prev]);
    setNewProjName("");
    setNewProjOpen(false);
    openProject(p.id);
  }

  function renameProject(id, name) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  }

  function setProjectInstructions(id, instructions) {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, instructions } : p)));
  }

  function deleteProject(id) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    // its chats lose the project tag but stay in history
    setChats((prev) => prev.map((c) => (c.projectId === id ? { ...c, projectId: null } : c)));
    setView("projects");
  }

  // --- sending / streaming -------------------------------------------------

  function send() {
    const text = input.trim();
    if (!text || busy) return;

    // find (or create) the chat this message belongs to
    let chat = chats.find((c) => c.id === activeId);
    let base = chats;
    if (!chat) {
      chat = blankChat(null);
      base = [chat, ...chats];
      setActiveId(chat.id);
    }
    const id = chat.id;
    const sessionId = chat.sessionId;

    // history the backend sees; a project's standing instructions ride in front
    const history = chat.messages.map((m) => ({ role: m.role, content: m.text }));
    const proj = projects.find((p) => p.id === chat.projectId);
    const fullHistory = proj && proj.instructions.trim()
      ? [{ role: "system", content: proj.instructions.trim() }, ...history]
      : history;

    const title = chat.messages.length === 0 ? titleFrom(text) : chat.title;

    const next = {
      ...chat,
      title,
      messages: [
        ...chat.messages,
        { role: "user", text },
        { role: "assistant", text: "", meta: null, events: [], receipt: null },
      ],
      updatedAt: Date.now(),
    };
    setChats(base.map((c) => (c.id === id ? next : c)));
    setInput("");
    setBusy(true);
    setView("chat");

    stopRef.current = chatStream({
      input: text,
      sessionId,
      history: fullHistory,
      onEvent: (ev) => handleEvent(id, ev),
      onError: (err) => {
        appendAssistant(id, `\n\n[error] ${err.message}`);
        setBusy(false);
      },
    });
  }

  function stop() {
    stopRef.current?.();
    setBusy(false);
  }

  // react to one streamed event, always landing it on the given chat's last
  // (assistant) message — by id, so it stays correct even if you navigate away
  function handleEvent(id, ev) {
    patchLast(id, (m) => ({ ...m, events: [...m.events, ev] }));

    if (ev.type === "text_delta" && ev.text) {
      appendAssistant(id, ev.text);
    } else if (ev.type === "assistant_message" && ev.text) {
      patchLast(id, (m) => (m.text.length === 0 ? { ...m, text: ev.text } : m));
    } else if (ev.type === "run_end") {
      const o = ev.outcome ?? {};
      patchLast(id, (m) => ({
        ...m,
        text: m.text.length === 0 && o.text ? o.text : m.text,
        meta: { ...(m.meta ?? {}), model: o.model, steps: o.steps, tokens: o.usage?.totalTokens },
      }));
    } else if (ev.type === "receipt") {
      patchLast(id, (m) => ({
        ...m,
        receipt: ev,
        meta: { ...(m.meta ?? {}), verified: ev.verified, model: ev.model ?? m.meta?.model },
      }));
    } else if (ev.type === "done") {
      setBusy(false);
    } else if (ev.type === "error") {
      appendAssistant(id, `\n\n[blocked] ${ev.message ?? "run failed"}`);
      setBusy(false);
    }
  }

  function appendAssistant(id, chunk) {
    patchLast(id, (m) => (m.role === "assistant" ? { ...m, text: m.text + chunk } : m));
  }

  // apply a function to the last (assistant) message of one chat, immutably
  function patchLast(id, fn) {
    setChats((prev) =>
      prev.map((c) => {
        if (c.id !== id || c.messages.length === 0) return c;
        const last = c.messages[c.messages.length - 1];
        if (last.role !== "assistant") return c;
        const msgs = [...c.messages];
        msgs[msgs.length - 1] = fn(last);
        return { ...c, messages: msgs, updatedAt: Date.now() };
      })
    );
  }

  // --- render --------------------------------------------------------------

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper text-ink">
      <Sidebar
        chats={chats}
        projects={projects}
        activeId={activeId}
        activeProjectId={activeProjectId}
        view={view}
        health={health}
        busy={busy}
        onNewChat={newChat}
        onOpenChat={openChat}
        onDeleteChat={deleteChat}
        onOpenProject={openProject}
        onNewProject={() => setNewProjOpen(true)}
        onOpenProjects={openProjects}
        onOpenInspect={openInspect}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="relative flex min-w-0 flex-1 flex-col">
        {view === "projects" && (
          <div className="flex-1 overflow-y-auto">
            <ProjectsGrid
              projects={projects}
              chats={chats}
              onOpen={openProject}
              onNew={() => setNewProjOpen(true)}
            />
          </div>
        )}

        {view === "inspect" && (
          <div className="min-h-0 flex-1 overflow-hidden">
            <Inspect />
          </div>
        )}

        {view === "project" && activeProject && (
          <div className="flex-1 overflow-y-auto">
            <ProjectView
              project={activeProject}
              chats={chats}
              onOpenChat={openChat}
              onNewChat={newChat}
              onRename={renameProject}
              onInstructions={setProjectInstructions}
              onDeleteChat={deleteChat}
              onDeleteProject={deleteProject}
            />
          </div>
        )}

        {view === "chat" && (
          <>
            <div ref={threadRef} className="flex-1 overflow-y-auto">
              {empty ? (
                <Welcome />
              ) : (
                <div className="mx-auto w-full max-w-[46rem] px-5 py-10">
                  {messages.map((m, i) => (
                    <Message
                      key={i}
                      role={m.role}
                      text={m.text}
                      meta={m.meta}
                      events={m.events}
                      receipt={m.receipt}
                      defaultOpen={prefs.showTrace}
                      streaming={busy && i === messages.length - 1 && m.role === "assistant"}
                    />
                  ))}
                </div>
              )}
            </div>
            <Composer value={input} onChange={setInput} onSend={send} onStop={stop} busy={busy} />
          </>
        )}
      </main>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        health={health}
        models={models}
        prefs={prefs}
        onPrefs={setPrefs}
      />

      {/* new project box */}
      <Modal open={newProjOpen} onClose={() => setNewProjOpen(false)} title="New project" width="26rem">
        <label className="mb-1.5 block font-mono text-[11px] text-ink-muted">Project name</label>
        <input
          autoFocus
          value={newProjName}
          onChange={(e) => setNewProjName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createProject()}
          placeholder="e.g. Thesis review"
          className="w-full rounded-[10px] border border-ink-line bg-paper-2/50 px-3 py-2 text-[14px] text-ink placeholder:text-ink-muted/50 focus:border-ink/30 focus:outline-none"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setNewProjOpen(false)}>
            Cancel
          </Button>
          <Button variant="solid" size="sm" onClick={createProject}>
            Create
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// The projects landing grid — a card per project plus a "new project" tile.
function ProjectsGrid({ projects, chats, onOpen, onNew }) {
  function count(id) {
    return chats.filter((c) => c.projectId === id && c.messages.length > 0).length;
  }

  return (
    <div className="mx-auto w-full max-w-[52rem] px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-[26px] font-semibold text-ink">Projects</h1>
          <p className="mt-1 text-[14px] text-ink-muted">Group related chats and give them shared instructions.</p>
        </div>
        <Button variant="solid" size="sm" onClick={onNew}>
          <Plus size={14} /> New project
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {projects.map((p) => (
          <button
            key={p.id}
            onClick={() => onOpen(p.id)}
            className="card group flex flex-col p-4 text-left transition-colors hover:border-ink/25"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-[9px] border border-ink-line bg-paper-2/70 text-ink-muted">
                <Folder size={15} />
              </span>
              <span className="truncate text-[15px] font-medium text-ink">{p.name}</span>
              <ArrowRight size={15} className="ml-auto text-ink-muted/40 transition-all group-hover:translate-x-0.5 group-hover:text-ink" />
            </div>
            <p className="line-clamp-2 min-h-[2.4em] text-[12.5px] leading-snug text-ink-muted">
              {p.instructions.trim() || "No instructions yet."}
            </p>
            <p className="mt-2 font-mono text-[10.5px] text-ink-muted/60">
              {count(p.id)} chats · {ago(p.createdAt)}
            </p>
          </button>
        ))}

        <button
          onClick={onNew}
          className="grid min-h-[128px] place-items-center rounded-[14px] border border-dashed border-ink-line text-ink-muted transition-colors hover:border-ink/30 hover:text-ink"
        >
          <span className="flex items-center gap-2 font-mono text-[12px]">
            <Plus size={14} /> New project
          </span>
        </button>
      </div>
    </div>
  );
}

// The empty chat state. Calm and centered: wordmark, one plain line, the single
// italic serif aside — the human voice borrowed from the homepage.
function Welcome() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 text-center">
      <span className="wordmark text-[34px] text-ink">
        OP<span className="text-signal">X</span>
      </span>
      <p className="aside mx-auto mt-5 max-w-[32rem] text-[19px] leading-relaxed text-ink-muted">
        Ask it to read, write, or reason over your files. It runs on local models,
        checks every step, and hands back a receipt you can verify.
      </p>
      <p className="label mt-6 text-ink-muted/60">Local models only · nothing leaves the room</p>
    </div>
  );
}

function firstChatId(chats) {
  const withMsgs = chats.filter((c) => c.messages.length > 0);
  return withMsgs[0]?.id ?? chats[0]?.id ?? null;
}
