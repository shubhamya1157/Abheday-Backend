// memory_search — lets the model query its own memory MID-run.
//
// retrieve-before-run already seeds the prompt with relevant memories, but the
// model sometimes realises partway through that it needs something specific
// ("have I edited this file before?"). This tool gives it explicit, on-demand
// recall. It is a READ tier tool — it only searches, never writes — so it needs
// no guardrail approval beyond the standard tier policy.

import { defineTool, type ToolDefinition } from "../../tools/registry.ts";
import type { MemoryManager } from "./memory-manager.ts";
import type { MemoryKind } from "./store.ts";

export function createMemorySearchTool(memory: MemoryManager): ToolDefinition {
  return defineTool({
    name: "memory_search",
    description:
      "Search your long-term memory for notes from past runs relevant to a query. " +
      "Use it to recall earlier decisions, project facts, or user preferences. " +
      "Returns the most similar stored notes, or nothing if none are relevant.",
    tier: "read",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to look for, in natural language.",
        },
        kind: {
          type: "string",
          enum: ["episodic", "project", "long-term"],
          description: "Optional: restrict to one memory kind.",
        },
      },
      required: ["query"],
    },
    handler: async (args: { query: string; kind?: MemoryKind }) => {
      const hits = await memory.retrieve(args.query, args.kind ? { kinds: [args.kind] } : {});
      if (hits.length === 0) {
        return { content: "No relevant memories found." };
      }
      const body = hits
        .map((h, i) => `${i + 1}. [${h.record.kind}, score ${h.score.toFixed(2)}] ${h.record.text}`)
        .join("\n");
      return {
        content: body,
        data: { count: hits.length },
      };
    },
  });
}
