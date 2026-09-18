import { useEffect, useState, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import Message from "@/components/Message";
import Composer from "@/components/Composer";
import { getHealth, getModels, chatStream } from "@/lib/api";

// A calm chat, the way you would actually want to talk to a model: a slim rail
// on the left for sessions and the backend's posture, and one centered column
// of conversation. The machinery — routing, guardrails, the trust receipt —
// is not hidden, it is folded under each answer, so the conversation stays the
// thing you read and the proof is one click away when you want it.
//
// Each assistant turn carries its own run: the events it streamed and the
// receipt it closed with live ON the message, so scrolling back shows you how
// any past answer was made, not just the latest.

export default function App() {
  const [health, setHealth] = useState(null);
  const [models, setModels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState(() => newSessionId());

  const stopRef = useRef(null);
  const threadRef = useRef(null);

  // load backend posture on mount, then keep it fresh every 15s
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

  // keep the newest message in view
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function newSession() {
    if (busy) return;
    setMessages([]);
    setSessionId(newSessionId());
  }

  function send() {
    const text = input.trim();
    if (!text || busy) return;

    const history = messages.map((m) => ({ role: m.role, content: m.text }));

    setMessages((prev) => [
      ...prev,
      { role: "user", text },
      { role: "assistant", text: "", meta: null, events: [], receipt: null },
    ]);
    setInput("");
    setBusy(true);

    stopRef.current = chatStream({
      input: text,
      sessionId,
      history,
      onEvent: handleEvent,
      onError: (err) => {
        appendAssistant(`\n\n[error] ${err.message}`);
        setBusy(false);
      },
    });
  }

  function stop() {
    stopRef.current?.();
    setBusy(false);
  }

  // one place that reacts to every streamed event. Everything lands on the
  // last (assistant) message so each turn owns its own run.
  function handleEvent(ev) {
    patchLast((m) => ({ ...m, events: [...m.events, ev] }));

    if (ev.type === "text_delta" && ev.text) {
      appendAssistant(ev.text);
    } else if (ev.type === "assistant_message" && ev.text) {
      patchLast((m) => (m.text.length === 0 ? { ...m, text: ev.text } : m));
    } else if (ev.type === "run_end") {
      const o = ev.outcome ?? {};
      patchLast((m) => ({
        ...m,
        text: m.text.length === 0 && o.text ? o.text : m.text,
        meta: { ...(m.meta ?? {}), model: o.model, steps: o.steps, tokens: o.usage?.totalTokens },
      }));
    } else if (ev.type === "receipt") {
      patchLast((m) => ({
        ...m,
        receipt: ev,
        meta: { ...(m.meta ?? {}), verified: ev.verified, model: ev.model ?? m.meta?.model },
      }));
    } else if (ev.type === "done") {
      setBusy(false);
    } else if (ev.type === "error") {
      appendAssistant(`\n\n[blocked] ${ev.message ?? "run failed"}`);
      setBusy(false);
    }
  }

  function appendAssistant(chunk) {
    patchLast((m) => (m.role === "assistant" ? { ...m, text: m.text + chunk } : m));
  }

  // apply a function to the last message, immutably
  function patchLast(fn) {
    setMessages((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role !== "assistant") return prev;
      const copy = [...prev];
      copy[copy.length - 1] = fn(last);
      return copy;
    });
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-paper text-ink">
      <Sidebar health={health} models={models} onNewSession={newSession} busy={busy} />

      <main className="relative flex min-w-0 flex-1 flex-col">
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
                  streaming={busy && i === messages.length - 1 && m.role === "assistant"}
                />
              ))}
            </div>
          )}
        </div>

        <Composer value={input} onChange={setInput} onSend={send} onStop={stop} busy={busy} />
      </main>
    </div>
  );
}

// The empty state. Calm and centered: the wordmark, one line of what this is,
// and the one italic serif aside — the human voice, borrowed from the homepage.
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

function newSessionId() {
  return "sess_" + Math.random().toString(36).slice(2, 10);
}
