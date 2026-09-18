# OPX Frontend — the workbench

The React app you actually talk to OPX through. It is the **machine room**: a
dark, three-column workbench that streams a run as it happens and shows you the
proof afterward. It reports the backend's real state — routing decisions,
guardrail actions, memory, egress posture, trust receipts — nothing here is
decoration.

## Stack

- **React 18** + **Vite 5** — plain `.jsx`, no TypeScript (matches the house style)
- **Tailwind 3** — the OPX design tokens copied straight from the marketing site
  (`opx-home`), so the workbench and the homepage speak the same visual language
- **motion** for the small entrance animations, **lucide-react** for icons
- `clsx` + `tailwind-merge` behind a `cn()` helper; a couple of shadcn-style
  primitives (`button`, `dot`)

No state library, no data-fetching library — the app is small enough that React
state and a hand-written fetch/SSE client are clearer than a framework.

## Run it

```bash
cd opx/frontend
npm install
npm run dev
```

Vite serves the app on `http://localhost:5173`. The dev server **proxies
`/api` → `http://127.0.0.1:8787`**, so start the backend first (see
[`../backend/README.md`](../backend/README.md)); the two run side by side with no
CORS setup. `npm run build` emits a static bundle to `dist/` for the deploy step
to serve.

## Layout

```
src/
  App.jsx              three-column shell; owns the run state and the SSE handler
  main.jsx             React root
  index.css            machine-room base + the .panel/.wordmark/.head/.aside layer
  lib/
    api.js             fetch + SSE client — getHealth/getModels/getTools,
                       verifyReceipt, and chatStream() that reads the event stream
    trace.js           maps each backend event to a labelled, colour-coded row
    utils.js           cn() class merger
  components/
    Sidebar.jsx        left rail — wordmark, system posture, the model registry
    Message.jsx        one conversation turn + its mono meta line
    Composer.jsx       the input row (Enter sends, Shift+Enter newlines, Stop)
    RunTrace.jsx       right rail — live event log + the trust-receipt card
    ui/button.jsx      button variants (enter/danger/outline/…)
    ui/dot.jsx         the round status light
```

## How it talks to the backend

On mount (and every 15s) it reads `/health` and `/models` to draw the left rail —
whether the backend is reachable, memory is on, egress is enforced, which model
is the planner. When you send, `chatStream()` POSTs to `/chat` and reads the
Server-Sent Events stream: `text_delta` frames stream the answer into the message,
`tool_call` / `tool_result` / `guardrail` frames light up the run trace, and the
closing `receipt` frame draws the trust-receipt card — green when it verified,
red when it did not. A guardrail block or a failed tool turns its row red no
matter what node colour it would otherwise carry.

## Design system

A calm, Claude-style chat: a slim left rail for sessions and the backend's
posture, one centered conversation column, and a rounded composer at the bottom.
The machinery — routing, guardrails, the trust receipt — is folded into a quiet
"steps" disclosure under each answer, so the conversation stays the thing you
read and the proof is one click away.

Tokens live in `tailwind.config.js` and the base layer in `index.css`, drawn
from `opx-home` so the workbench and the marketing site are one product:

- **The paper room.** The homepage moves between paper (`#EDF0EC`, the plant
  office) and plant (`#08090A`, the machine room). The workbench uses the
  **paper room** — light, cream, ink text — because that is the calm, readable
  surface a chat wants to be.
- **Signals, used sparingly.** amber `signal #FF8A2B` = the run / the send button,
  `sealed #57D98A` = verified / zero egress, `denied #FF4D3D` = blocked.
- **Node palette.** trigger pink, logic blue, guard cyan, model violet, tool teal,
  out green — the folded run steps and the model list are tagged by *what a thing
  is*, the same colour language as the homepage's node canvas.
- **Type.** Chakra Petch for the wordmark only (the X in amber), IBM Plex Sans for
  the conversation, IBM Plex Mono for data/labels, one italic Newsreader aside on
  the empty state — the human voice, borrowed from the homepage.
- Corners squared but never sharp; only status lights and the send button round.

## Verification note

This was built in an offline sandbox with no npm registry access, so a full
`npm install && vite build` was **not runnable here**. What was verified: every
`.jsx` parses (Babel), the app server-side-renders without throwing (so imports,
hooks, and JSX are sound), and the Tailwind classes used across the components all
compile. Run `npm install && npm run build` locally to confirm the production
bundle before shipping.
