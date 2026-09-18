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
  frontend/    unified React app                          ← planned
  deploy/      ops: runs the local llama.cpp .gguf model servers  ← planned
```

This pass built the **backend + semantic memory core**. Frontend and deploy are
deferred. See [`backend/README.md`](./backend/README.md) for the API, folder
layout, and how to run it.

## The idea in one paragraph

Several local models (a planner, a coder, a vision/OCR model, an embedding model),
each a llama.cpp server on its own port. A request comes in, the planner-style
router classifies it and picks the best-fit specialist model. The agent loop runs
it with tools, checking every stage against guardrails (injection, secrets,
tool-policy). Relevant memories from past runs are pulled in before the run and
the outcome is written back after. An egress guard blocks any non-local network
call, so sovereignty is enforced in code. Every run emits a trust receipt that
can be independently verified.
