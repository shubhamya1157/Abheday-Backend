# OPX — Sovereign Agentic AI Workbench

The unified project. OPX is an air-gapped, on-premise agentic AI system: it runs
multiple open-weight models locally on llama.cpp, routes each task to the best
model, and executes it through a guarded agent loop with semantic memory and a
verifiable audit trail.

## Structure

```
opx/
  backend/     the agentic backend — multi-model routing, semantic memory,
               guardrails, trust receipts, HTTP API      ← built
  frontend/    the workbench — React app you talk to OPX through  ← built
  deploy/      ops: runs the local llama.cpp .gguf model servers  ← planned
```

This built the **backend + semantic memory core** and the **workbench frontend**
on top of it. Deploy (running the local `.gguf` model servers) is still deferred.
See [`backend/README.md`](./backend/README.md) for the API and folder layout, and
[`frontend/README.md`](./frontend/README.md) for the workbench.

## Running it

Two processes, side by side:

```bash
# 1. the backend (serves the API on :8787)
cd backend && npm install && npm run dev

# 2. the workbench (Vite on :5173, proxies /api → :8787)
cd frontend && npm install && npm run dev
```

Open `http://localhost:5173`. The left rail shows the backend's live posture,
the middle is the conversation, and the right rail streams each run's steps and
its trust receipt. (Model servers themselves are the `deploy/` step — the
backend expects llama.cpp servers on their local ports.)

## The idea in one paragraph

Several local models (a planner, a coder, a vision/OCR model, an embedding model),
each a llama.cpp server on its own port. A request comes in, the planner-style
router classifies it and picks the best-fit specialist model. The agent loop runs
it with tools, checking every stage against guardrails (injection, secrets,
tool-policy). Relevant memories from past runs are pulled in before the run and
the outcome is written back after. An egress guard blocks any non-local network
call, so sovereignty is enforced in code. Every run emits a trust receipt that
can be independently verified.
