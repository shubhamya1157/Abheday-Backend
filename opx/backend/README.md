# OPX Backend — Sovereign Agentic Workbench

An air-gapped, on-premise agentic AI backend. It runs several **local** open-weight
models on llama.cpp at once, analyses each task and routes it to the best model,
and executes an agent loop with tools, guardrails, semantic memory, and a
verifiable trust receipt for every run. No vendor SDKs, no agent frameworks, no
build step — it runs TypeScript directly on Node 22.

## What it does

- **Multi-model routing.** A planner/default model plus specialists (coding,
  vision/OCR, reasoning), each a local llama.cpp server on its own port. Every
  request is classified and routed to the best-fit model; the planner is the
  fallback.
- **Semantic memory.** Relevant memories are retrieved by embedding similarity
  and injected before each run; the outcome is written back after. Stored as a
  plain JSON vector file — no database, no native modules.
- **Guardrails.** Always-on built-in guards (prompt-injection, secret redaction,
  tool-policy, protected-paths) with an optional external engine layered on top.
  Fail-closed by default.
- **Sovereignty.** An egress guard patches `fetch` and refuses any non-loopback
  host, so the air-gap is enforced in code, not just claimed.
- **Trust receipt.** Every run produces an ordered, gap-checked, independently
  verifiable audit record.

## Folder layout (conventional MVC + the architecture blueprint)

```
src/
  server.ts              boot: load config, start harness, listen
  app.ts                 express assembly (middleware → routes → error handling)

  config/                configuration + the multi-model registry loader
  core/                  shared domain types (zero imports)

  routes/                HTTP routes            — chat, receipt, system
  controllers/           request handlers       — chat, receipt, system
  middleware/            auth (bearer), cors

  services/              the blueprint layers
    agent/               the agentic engine     — harness, loop, events
    orchestrator/        planner / model routing — router, task-analyzer, resolve
    guardrails/          input validation + safety — pipeline, guards, adapter
    memory/              semantic memory layer  — context, embedding, store,
                                                  cosine, memory-manager, tool
    models/              model CLIENTS          — llama-provider, model-registry
    security/            egress guard (sovereignty enforcement)
    audit/               trust receipt

  protocol/              tool-call protocols (native / prompted / grammar)
  prompt/                system-prompt composition
  tools/                 built-in tools + registry
  utils/                 shared HTTP helpers
```

> `services/models/` is the app-side HTTP **client** that *calls* the models.
> The `deploy/` folder (elsewhere) is the ops side that *runs* the llama.cpp
> `.gguf` servers. They are deliberately separate.

## Requirements

- **Node 22.18+** (uses native `.ts` type-stripping — no compile step).
- One or more **local llama.cpp servers** (or LM Studio / vLLM — anything
  OpenAI-compatible), plus a local **embedding** server for memory.

## Quick start

```bash
cd opx/backend
cp .env.example .env          # edit MODEL_BASE_URL, MODELS_JSON, WORKSPACE_ROOT
npm install                   # installs deps; @llm-guardrails/core is optional
npm run dev                   # node --watch --env-file=.env src/server.ts
```

The server boots even if a model is down, and reports what is unreachable at
`GET /api/v1/health` so it is easy to debug.

## Configuring models

Set a registry inline in `.env` (or point `MODELS_CONFIG_PATH` at a file). Each
model is a local endpoint:

```
MODELS_JSON=[
  {"id":"planner","role":"reasoning","endpoint":"http://127.0.0.1:8080","priority":1},
  {"id":"coder","role":"coding","endpoint":"http://127.0.0.1:8081","priority":2},
  {"id":"vision","role":"vision","endpoint":"http://127.0.0.1:8082","priority":2}
]
ROUTING_ENABLED=true
EMBEDDING_BASE_URL=http://127.0.0.1:8090
```

With no registry set, the single `MODEL_*` model is used on its own.

## HTTP API (all under `/api/v1`)

| Method | Path              | Purpose                                            |
| ------ | ----------------- | -------------------------------------------------- |
| POST   | `/chat`           | Run the agent, return one JSON result              |
| POST   | `/chat/stream`    | Run with Server-Sent Events (one frame per step)   |
| POST   | `/receipt/verify` | Independently verify a trust receipt               |
| POST   | `/receipt/render` | Render a receipt as Markdown                       |
| GET    | `/health`         | Liveness + which model servers are reachable       |
| GET    | `/models`         | Registered models and routing state                |
| GET    | `/tools`          | Tool catalogue as advertised to the model          |
| GET    | `/system-prompt`  | The composed system prompt (no secrets)            |

Request body: `{ "input": "...", "sessionId": "optional", "history": [...] }`.
The response includes which model handled the run and why.

## Security notes

- Binding to a non-loopback host **requires** `API_TOKEN`; the server refuses to
  start otherwise, because an agent that writes files behind an unauthenticated
  network port is a remote shell.
- Bearer-token comparison is timing-safe.
- Guardrails fail **closed**: a guard that errors or times out blocks the request.
- Enabling `web_search` sends a query string off-box and ends the air-gap;
  `/health` reports this.

## Verification status

Type-safety was checked structurally (all relative imports resolve; public API
surfaces between modules match). A full `tsc --noEmit` and `npm install` require
network access to the npm registry, which is blocked in the build sandbox — run
both locally before deploying.
