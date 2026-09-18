import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import { cn } from "@/lib/utils";
import Receipt from "@/components/Receipt";

// How it works, drawn the way n8n draws a workflow: typed nodes wired into a
// canvas, one packet travelling through them, and a panel beside it showing
// what actually went into and came out of whichever node you are looking at.
//
// The shape below is one real request. The part worth staring at is the loop:
// the local model is asked what to do next, anything it wants to touch has to
// get past four fail-closed hooks, and the result goes back in and the model
// is asked again. This run makes two passes — one to read, one to write.

// n8n colours a workflow by what each node *is*, so you can read the shape of
// a flow before reading a single label. Same idea here. Written out as whole
// class names on purpose: Tailwind only generates strings it can literally
// find in the file, so `text-node-${type}` would silently produce nothing.
const TONE = {
  trigger: {
    text: "text-node-trigger",
    strip: "bg-node-trigger",
    chip: "border-node-trigger/40 text-node-trigger",
  },
  logic: {
    text: "text-node-logic",
    strip: "bg-node-logic",
    chip: "border-node-logic/40 text-node-logic",
  },
  guard: {
    text: "text-node-guard",
    strip: "bg-node-guard",
    chip: "border-node-guard/40 text-node-guard",
  },
  model: {
    text: "text-node-model",
    strip: "bg-node-model",
    chip: "border-node-model/40 text-node-model",
  },
  tool: {
    text: "text-node-tool",
    strip: "bg-node-tool",
    chip: "border-node-tool/40 text-node-tool",
  },
  out: {
    text: "text-node-out",
    strip: "bg-node-out",
    chip: "border-node-out/40 text-node-out",
  },
};

const LEGEND = [
  { type: "trigger", label: "request" },
  { type: "logic", label: "logic" },
  { type: "guard", label: "guard" },
  { type: "model", label: "model" },
  { type: "tool", label: "tool" },
  { type: "out", label: "output" },
];

// Every node on the canvas. `frames` is what the inspector shows: index 0 is
// the first pass through the loop, index 1 the second. Nodes that do the same
// thing both times only need one frame.
const NODES = [
  {
    id: "http",
    type: "trigger",
    name: "POST /run",
    sub: "express · server-sent events",
    why: "The Express process is the only thing in the system that ever talks to the model. The page opens an EventSource and listens; it is never given a model endpoint to call.",
    frames: [
      {
        in: '{\n  "prompt": "Draft the note sheet for replacing PSV-2103A.",\n  "tools": true\n}',
        out: 'event: run_start\n{"runId":"r-8f21","model":"gemma-3-1b-it","airGapped":true}',
      },
    ],
  },
  {
    id: "admit",
    type: "logic",
    name: "admission",
    sub: "schema check · fail closed",
    why: "The body is parsed against a schema rather than trusted. Anything that does not match is refused here, before a single token is generated.",
    frames: [
      {
        in: "raw request body — shape not yet known",
        out: '{\n  "ok": true,\n  "maxSteps": 8,\n  "maxToolCalls": 3\n}',
      },
    ],
  },
  {
    id: "assemble",
    type: "logic",
    name: "context assembly",
    sub: "system prompt + tool schemas",
    why: "The system prompt carries the plant vocabulary — tag numbers, note-sheet layout, what a PSV is — and then the five file tools are described alongside it. How they are described was settled at boot: a capability probe asks the local server once whether it can do native tool calls, and the loop falls back to prompted JSON if it cannot.",
    frames: [
      {
        in: '{ "prompt": "Draft the note sheet…", "history": [] }',
        out: 'messages: [\n  { role: "system", content: "You are OPX. You run on a machine\n     with no route to the internet…" },\n  { role: "user",   content: "Draft the note sheet for PSV-2103A." }\n]\ntools: read_file · write_file · list_dir · stat_file · search_files\nprotocol: native (probed at boot)',
      },
    ],
  },
  {
    id: "model",
    type: "model",
    name: "provider.chat()",
    sub: "plain fetch · llama.cpp / lm studio",
    loop: true,
    why: "A hand-written client over fetch. There is no vendor SDK anywhere in the dependency tree, which means there is no library in the process that could decide to send telemetry somewhere.",
    frames: [
      {
        in: "messages: 2 · tools: 5 · stream: true",
        out: "200 · text/event-stream opened",
      },
      {
        in: "messages: 4 (system, user, tool_call, tool_result)\ntools: 5 · stream: true",
        out: "200 · text/event-stream opened — second pass",
      },
    ],
  },
  {
    id: "tokens",
    type: "model",
    name: "token stream",
    sub: "one token at a time",
    loop: true,
    why: "Tokens are forwarded to the browser the moment they arrive rather than buffered into one reply, which is why a 1B model on a CPU still feels like something is happening.",
    frames: [
      { in: "raw sse chunks", out: 'event: token {"t":"Reading the last inspection report."}' },
      { in: "raw sse chunks", out: 'event: token {"t":"Writing the note sheet now."}' },
    ],
  },
  {
    id: "intent",
    type: "logic",
    name: "tool intent",
    sub: "native call | parsed from text",
    loop: true,
    why: "Either the server handed back a structured tool call or the loop parsed one out of the text. Both roads end at the same object, so every guard downstream only has one shape to reason about.",
    frames: [
      {
        in: "the model's turn so far",
        out: '{\n  "name": "read_file",\n  "args": { "path": "/plant/insp/PSV-2103A.md" }\n}',
      },
      {
        in: "the model's turn so far",
        out: '{\n  "name": "write_file",\n  "args": { "path": "/out/NS-PSV-2103A.md" }\n}',
      },
    ],
  },
  {
    id: "before",
    type: "guard",
    name: "beforeTool",
    sub: "hook 1 of 4",
    loop: true,
    why: "Every hook has to return allow. A hook that throws counts as a deny rather than a warning — that is the whole meaning of fail-closed, and it is why a bug in a guard cannot accidentally open the door.",
    frames: [
      {
        in: '{ "name": "read_file", "args": { "path": "/plant/insp/PSV-2103A.md" } }',
        out: '{ "hook": "beforeTool", "verdict": "allow" }',
      },
      {
        in: '{ "name": "write_file", "args": { "path": "/out/NS-PSV-2103A.md" } }',
        out: '{ "hook": "beforeTool", "verdict": "allow" }',
      },
    ],
  },
  {
    id: "jail",
    type: "guard",
    name: "path jail",
    sub: "two layers · textual + realpath",
    loop: true,
    why: "The first layer rejects the string itself — `..`, absolute escapes, anything that climbs. The second resolves the path on disk and checks where it really lands, so a symlink that points out of the workspace still fails. One layer would not be enough; the string can be innocent and the disk can disagree.",
    frames: [
      {
        in: '"/plant/insp/PSV-2103A.md"',
        out: '{\n  "textual": "ok",\n  "realpath": "/plant/insp/PSV-2103A.md",\n  "insideWorkspace": true\n}',
      },
      {
        in: '"/out/NS-PSV-2103A.md"',
        out: '{\n  "textual": "ok",\n  "realpath": "/out/NS-PSV-2103A.md",\n  "insideWorkspace": true\n}',
      },
    ],
  },
  {
    id: "egress",
    type: "guard",
    name: "egress guard",
    sub: "fetch replaced at boot",
    loop: true,
    spur: true,
    why: "At boot, `fetch` is swapped for one that refuses every host except the local model. It is not a setting a prompt can talk its way past, and it covers the whole process — including any dependency that decided to phone home. Nothing tried on this run. The dashed branch is what happens if anything ever does.",
    frames: [
      {
        in: "every outbound call attempted anywhere in the process",
        out: '{ "allowedHost": "127.0.0.1", "egressAttempts": 0 }',
      },
    ],
  },
  {
    id: "tool",
    type: "tool",
    name: "tool call",
    sub: "1 of 5 file tools",
    loop: true,
    why: "The tools are small and boring on purpose: read, write, list, stat, search. Everything interesting happens in the loop around them, which means there is very little surface area to get wrong.",
    frames: [
      {
        in: 'read_file "/plant/insp/PSV-2103A.md"',
        out: 'event: tool_result {"bytes":2841,"lines":74}',
      },
      {
        in: 'write_file "/out/NS-PSV-2103A.md"',
        out: 'event: artifact {"file":"NS-PSV-2103A.md","words":612}',
      },
    ],
  },
  {
    id: "after",
    type: "guard",
    name: "afterTool",
    sub: "hook 4 · result clamped",
    loop: true,
    why: "The result is size-clamped before it is allowed back into the prompt, so one oversized file cannot push the instructions out of a small context window. On a 1B model that is the difference between an answer and nonsense.",
    frames: [
      {
        in: "2841 bytes from disk",
        out: '{ "bytes": 2841, "truncated": false, "backToModel": true }',
      },
      {
        in: "write receipt: 612 words",
        out: '{ "ok": true, "backToModel": true, "modelStopsHere": true }',
      },
    ],
  },
  {
    id: "artifact",
    type: "out",
    name: "artifact",
    sub: "a file on your disk",
    why: "This is the point of the whole run. Not a chat reply you have to copy somewhere — a note sheet in a folder, with the plant's own tag numbers in it.",
    frames: [
      {
        in: "the model's final turn",
        out: "/out/NS-PSV-2103A.md\n612 words · 4 sections · 2 citations back to the inspection report",
      },
    ],
  },
  {
    id: "receipt",
    type: "out",
    name: "receipt",
    sub: "numbered · gap-checked",
    why: "Every event in the run carries a sequence number, and verifyReceipt() checks they run 1..N with nothing missing, naming the exact index where the sequence breaks. It is ordered and gap-checked. It is not hashed and not signed, and we do not claim otherwise.",
    frames: [
      {
        in: "12 events collected during the run",
        out: '{\n  "events": 12,\n  "seq": "1..12",\n  "gaps": 0,\n  "verified": true\n}',
      },
    ],
  },
  {
    id: "end",
    type: "out",
    name: "run_end",
    sub: "stream closed",
    why: "Two passes through the loop, one artifact, zero outbound attempts. That last number is the one a judge can check independently with a network monitor while the run happens — which is the only reason any of the rest of this matters.",
    frames: [
      {
        in: "loop finished · model asked for no more tools",
        out: '{\n  "ms": 18240,\n  "steps": 2,\n  "toolCalls": 2,\n  "egressAttempts": 0\n}',
      },
    ],
  },
];

// The playback script: which node lights up, and which pass of the loop it is
// on. The beat marked `back` is the jump from the end of the loop up to the
// model again — the thing that makes this an agent rather than one call.
const SCRIPT = [
  { id: "http", pass: 1 },
  { id: "admit", pass: 1 },
  { id: "assemble", pass: 1 },
  { id: "model", pass: 1 },
  { id: "tokens", pass: 1 },
  { id: "intent", pass: 1 },
  { id: "before", pass: 1 },
  { id: "jail", pass: 1 },
  { id: "egress", pass: 1 },
  { id: "tool", pass: 1 },
  { id: "after", pass: 1 },
  { id: "model", pass: 2, back: true },
  { id: "tokens", pass: 2 },
  { id: "intent", pass: 2 },
  { id: "before", pass: 2 },
  { id: "jail", pass: 2 },
  { id: "egress", pass: 2 },
  { id: "tool", pass: 2 },
  { id: "after", pass: 2 },
  { id: "artifact", pass: 2 },
  { id: "receipt", pass: 2 },
  { id: "end", pass: 2 },
];

const BEAT = 620; // ms a node stays lit
const HOLD = 7; // extra beats at the end so the receipt can be read

// the three stretches of the canvas: before the loop, the loop, after the loop
const BEFORE_LOOP = NODES.filter((n) => !n.loop).slice(0, 3);
const IN_LOOP = NODES.filter((n) => n.loop);
const AFTER_LOOP = NODES.filter((n) => !n.loop).slice(3);

// one wire between two nodes. Fills with amber once the packet has passed.
function Wire({ hot }) {
  return (
    <div className="relative ml-[26px] h-5 w-px bg-line">
      <span
        className={cn(
          "absolute inset-x-0 top-0 bg-signal transition-[height] duration-300 ease-out",
          hot ? "h-full" : "h-0"
        )}
      />
    </div>
  );
}

// One node. A real button, so the whole flow can be walked with a keyboard.
function NodeCard({ node, n, state, shown, onOpen, cardRef }) {
  const tone = TONE[node.type];
  const active = state === "active";
  const done = state === "done";

  return (
    <button ref={cardRef} type="button" onClick={onOpen} className="block w-full text-left">
      <div
        className={cn(
          "relative flex items-center gap-3 overflow-hidden rounded-[10px] border py-3 pl-4 pr-2.5 transition-colors duration-300",
          active
            ? "border-signal bg-plant-3"
            : shown
              ? "border-bone-muted/40 bg-plant-3"
              : "border-line bg-plant-3/70 hover:border-bone-muted/30"
        )}
      >
        {/* the type strip — this is the colour you read the flow by */}
        <span
          className={cn(
            "absolute inset-y-0 left-0 w-[3px] transition-opacity duration-300",
            tone.strip,
            active || done || shown ? "opacity-100" : "opacity-35"
          )}
        />

        <span className="font-mono text-[10px] tabular-nums text-bone-muted/45">{n}</span>

        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "head block text-[14px] leading-tight transition-colors duration-300",
              active ? "text-signal" : done || shown ? "text-bone" : "text-bone-muted/70"
            )}
          >
            {node.name}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-bone-muted/55">
            {node.sub}
          </span>
        </span>

        {/* amber while it runs, green once it is behind us */}
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300",
            active ? "animate-breathe bg-signal" : done ? "bg-sealed" : "bg-line"
          )}
        />

        <span className={cn("label shrink-0 rounded-[5px] border px-1.5 py-1 text-[9px]", tone.chip)}>
          {node.type}
        </span>
      </div>
    </button>
  );
}

// The branch nothing took. Dashed and dim on purpose: it is what *would*
// happen if any code in this process tried to reach the network. Drawing it
// solid would suggest it fired, and on this run it did not.
function Spur({ lit }) {
  return (
    <div className="ml-[26px] flex items-start gap-2 pt-2">
      <span className="mt-3.5 block h-px w-5 shrink-0 bg-denied/35" />
      <div
        className={cn(
          "flex-1 rounded-[9px] border border-dashed px-3 py-2 transition-colors duration-300",
          lit ? "border-denied/60 bg-denied/[0.06]" : "border-denied/25"
        )}
      >
        <span className="label block text-[9px] text-denied/85">refused · if anything tries</span>
        <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-bone-muted/70">
          api.openai.com · sentry.io · telemetry.any · every host that is not the model
          running on this machine
        </p>
        <p className="mt-1 font-mono text-[10px] text-sealed">attempts on this run: 0</p>
      </div>
    </div>
  );
}

// A stretch of the canvas: nodes, the wires between them, and any spur.
function Chain({ nodes, start, activeId, visited, shownId, onOpen, refs }) {
  return (
    <>
      {nodes.map((node, i) => (
        <div key={node.id}>
          {i > 0 && <Wire hot={visited.has(node.id) || activeId === node.id} />}
          <NodeCard
            node={node}
            n={String(start + i + 1).padStart(2, "0")}
            state={activeId === node.id ? "active" : visited.has(node.id) ? "done" : "idle"}
            shown={shownId === node.id}
            onOpen={() => onOpen(node.id)}
            cardRef={(el) => {
              refs.current[node.id] = el;
            }}
          />
          {node.spur && <Spur lit={activeId === node.id} />}
        </div>
      ))}
    </>
  );
}

export default function HowItWorks() {
  const sectionRef = useRef(null);
  const inView = useInView(sectionRef, { amount: 0.2 });

  // where playback is, and which node the reader has pinned open
  const [cursor, setCursor] = useState(0);
  const [pinned, setPinned] = useState(null);

  const canvasRef = useRef(null);
  const cardRefs = useRef({});

  // clicking a node pauses the run. Nothing moves while you are reading.
  const playing = inView && !pinned;

  // the run plays itself, holds a few beats on the receipt, then starts over
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setCursor((n) => (n >= SCRIPT.length + HOLD ? 0 : n + 1));
    }, BEAT);
    return () => clearInterval(timer);
  }, [playing]);

  const beat = SCRIPT[cursor] ?? null;
  const activeId = beat ? beat.id : null;
  const visited = new Set(SCRIPT.slice(0, cursor).map((b) => b.id));
  const finished = cursor >= SCRIPT.length;

  // the panel shows the pinned node if there is one, otherwise whatever is
  // running right now
  const shownId = pinned ?? activeId;
  const shown = NODES.find((node) => node.id === shownId) ?? NODES[0];
  const pass = pinned ? 1 : beat ? beat.pass : 1;
  const frame = shown.frames[pass - 1] ?? shown.frames[0];

  // Keep the running node in sight without dragging the whole page around:
  // scroll the canvas box on its own, by the gap between the two rectangles.
  useEffect(() => {
    if (pinned || !activeId) return;
    const box = canvasRef.current;
    const card = cardRefs.current[activeId];
    if (!box || !card) return;
    const boxBox = box.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    const top = box.scrollTop + (cardBox.top - boxBox.top) - boxBox.height / 2 + cardBox.height / 2;
    box.scrollTo({ top, behavior: "smooth" });
  }, [activeId, pinned]);

  // clicking the node that is already open closes it and the run resumes
  const openNode = (id) => setPinned((current) => (current === id ? null : id));

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="relative bg-plant px-4 py-24 sm:px-6 sm:py-28"
    >
      <div className="mx-auto max-w-page">
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-6">
          <div>
            <span className="label text-bone-muted/60">How it works</span>
            <h2 className="head mt-4 max-w-[20ch] text-[clamp(1.9rem,4.6vw,3.4rem)] text-bone">
              One request, all the way down
            </h2>
          </div>
          <p className="max-w-[46ch] text-[14.5px] leading-relaxed text-bone-muted">
            A real run, drawn the way a workflow is drawn. A prompt arrives, the local model
            is asked what to do next, and anything it wants to touch has to get past four
            hooks that fail closed. Click any node to stop the run and read what actually
            went into it and came out.
          </p>
        </div>

        {/* the colours, so the canvas can be read before it is read */}
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-5">
          {LEGEND.map((item) => (
            <span
              key={item.type}
              className="label flex items-center gap-2 text-[9.5px] text-bone-muted/70"
            >
              <span className={cn("h-2.5 w-[3px]", TONE[item.type].strip)} />
              {item.label}
            </span>
          ))}
          <span className="label flex items-center gap-2 text-[9.5px] text-bone-muted/70 sm:ml-auto">
            <span className="h-0 w-3.5 border-t border-dashed border-denied/70" />
            refused branch
          </span>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]">
          {/* the canvas */}
          <div className="overflow-hidden rounded-[14px] border border-line bg-plant-2">
            {/* a title bar, the way a node editor has one */}
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="label text-[9.5px] text-bone-muted/60">run · r-8f21</span>
              <span className="label flex items-center gap-2 text-[9.5px] text-bone-muted/60">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    playing ? "animate-breathe bg-signal" : "bg-bone-muted/40"
                  )}
                />
                {pinned
                  ? "paused · a node is open"
                  : finished
                    ? "run complete"
                    : `step ${cursor + 1} of ${SCRIPT.length}`}
              </span>
            </div>

            {/* the flow itself. Everything sits in a left gutter so the loop
                bracket has somewhere to live without pushing nodes around. */}
            <div ref={canvasRef} className="dot-grid h-[520px] overflow-y-auto px-4 py-5">
              <div className="pl-9">
                <Chain
                  nodes={BEFORE_LOOP}
                  start={0}
                  activeId={activeId}
                  visited={visited}
                  shownId={shownId}
                  onOpen={openNode}
                  refs={cardRefs}
                />

                <Wire hot={visited.has("model")} />

                {/* The loop, and the reason this is a diagram and not a list:
                    the model is asked, the guards run, the result goes back in,
                    and the model is asked again. Two passes on this run — one to
                    read the inspection report, one to write the note sheet. */}
                <div className="relative">
                  <div
                    className={cn(
                      "pointer-events-none absolute -left-8 bottom-6 top-6 w-7 rounded-l-[14px] border-y border-l border-dashed transition-colors duration-300",
                      beat && beat.back ? "border-signal" : "border-bone-muted/25"
                    )}
                  >
                    {/* the arrowhead where the wire re-enters the model */}
                    <span className="absolute -top-[3.5px] right-0 h-1.5 w-1.5 rotate-45 border-r border-t border-inherit" />
                    <span className="label absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-plant-2 py-2 text-[8.5px] text-bone-muted/60 [writing-mode:vertical-rl]">
                      loop ×2
                    </span>
                  </div>

                  <Chain
                    nodes={IN_LOOP}
                    start={BEFORE_LOOP.length}
                    activeId={activeId}
                    visited={visited}
                    shownId={shownId}
                    onOpen={openNode}
                    refs={cardRefs}
                  />
                </div>

                <Wire hot={visited.has("artifact")} />

                <Chain
                  nodes={AFTER_LOOP}
                  start={BEFORE_LOOP.length + IN_LOOP.length}
                  activeId={activeId}
                  visited={visited}
                  shownId={shownId}
                  onOpen={openNode}
                  refs={cardRefs}
                />
              </div>
            </div>
          </div>

          {/* The inspector — the panel a node editor opens when you double
              click a node. It follows the run on its own, and stays on whatever
              you clicked until you let it go. */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="overflow-hidden rounded-[14px] border border-line bg-plant-2">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="label text-[9.5px] text-bone-muted/60">node inspector</span>
                {pinned ? (
                  <button
                    type="button"
                    onClick={() => setPinned(null)}
                    className="label rounded-[6px] border border-signal/40 px-2 py-1 text-[9px] text-signal transition-colors hover:bg-signal/10"
                  >
                    resume run
                  </button>
                ) : (
                  <span className="label text-[9.5px] text-bone-muted/40">following the run</span>
                )}
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={shown.id + pass}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22 }}
                  className="px-4 py-5"
                >
                  <div className="flex items-center gap-2.5">
                    <span className={cn("h-3 w-[3px] shrink-0", TONE[shown.type].strip)} />
                    <h3 className={cn("head text-[17px]", TONE[shown.type].text)}>{shown.name}</h3>
                    {shown.loop && (
                      <span className="label ml-auto shrink-0 text-[9px] text-bone-muted/50">
                        pass {pass} of 2
                      </span>
                    )}
                  </div>

                  {/* what went in and what came out. Real payloads, not prose. */}
                  {[
                    { key: "input", value: frame.in, dim: true },
                    { key: "output", value: frame.out, dim: false },
                  ].map((row) => (
                    <div key={row.key} className="mt-4">
                      <span className="label text-[9px] text-bone-muted/45">{row.key}</span>
                      <pre
                        className={cn(
                          "mt-1.5 max-h-[160px] overflow-auto whitespace-pre-wrap break-words rounded-[9px] border border-line bg-plant px-3 py-2.5 font-mono text-[11px] leading-relaxed",
                          row.dim ? "text-bone-muted" : "text-bone/90"
                        )}
                      >
                        {row.value}
                      </pre>
                    </div>
                  ))}

                  <p className="mt-5 border-t border-line pt-4 text-[13.5px] leading-relaxed text-bone-muted">
                    {shown.why}
                  </p>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* the run in one line, for anyone who does not want to click */}
            <p className="mt-4 px-1 font-mono text-[10.5px] leading-relaxed text-bone-muted/55">
              2 passes · 2 tool calls · 4 hooks per call · 1 artifact · 12 receipt events ·{" "}
              <span className="text-sealed">0 outbound attempts</span>
            </p>
          </div>
        </div>

        {/* The tag stapled to the artifact, once the run finishes. Ordered and
            gap-checked — not hashed, not signed. */}
        <Receipt visible={finished} />
      </div>
    </section>
  );
}
