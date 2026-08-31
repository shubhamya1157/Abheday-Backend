import { randomUUID } from "node:crypto";

import { classifyTask } from "./task-analyzer.js";
import { CapabilityRouter } from "./router.js";
import type {
  AgentRequest,
  AgentRunResult,
  ExecutionContext,
  ExecutionPlan,
  ModelDescriptor,
  ModelGateway,
  TraceEvent,
} from "./types.js";

export type { AgentRequest } from "./types.js";

export interface OrchestratorOptions {
  models: ModelDescriptor[];
  modelGateway: ModelGateway;
  maxIterations?: number;
  maxToolCalls?: number;
  timeoutMs?: number;
  workspaceRoot?: string;
}

export function createAgentOrchestrator(options: OrchestratorOptions) {
  const router = new CapabilityRouter(options.models);
  const trace: TraceEvent[] = [];

  return {
    async run(request: AgentRequest): Promise<AgentRunResult> {
      const runId = request.requestId ?? randomUUID();
      const task = classifyTask(request.userInput);
      const context: ExecutionContext = {
        runId,
        request,
        task,
        messages: [{ role: "user", content: request.userInput }],
        observations: [],
        toolCalls: [],
        artifacts: [],
        metadata: { workspaceRoot: options.workspaceRoot ?? process.cwd() },
        status: "running",
      };

      const plan: ExecutionPlan = { steps: [{ id: "step-1", type: "model", description: "Generate an answer or initial plan" }] };
      context.plan = plan;

      const startedAt = new Date().toISOString();
      trace.push({ event: "RUN_STARTED", timestamp: startedAt, details: { runId, task } });

      try {
        const selected = await router.route(task, context);
        context.selectedModel = selected.model;
        trace.push({ event: "MODEL_SELECTED", timestamp: new Date().toISOString(), details: { model: selected.model.id, reason: selected.reason } });

        const generated = await options.modelGateway.generate(
          selected.model,
          {
            prompt: request.userInput,
            systemPrompt: "You are a local sovereign orchestrator assistant.",
            maxTokens: 512,
            temperature: 0.2,
          },
          context,
        );

        context.messages.push({ role: "assistant", content: generated.text });
        context.status = "completed";
        trace.push({ event: "MODEL_CALL_COMPLETED", timestamp: new Date().toISOString(), details: { model: selected.model.id, text: generated.text } });

        return {
          runId,
          status: "completed",
          output: generated.text,
          trace,
          artifacts: context.artifacts,
        };
      } catch (error) {
        context.status = "failed";
        const message = error instanceof Error ? error.message : "Unknown error";
        trace.push({ event: "RUN_FAILED", timestamp: new Date().toISOString(), details: { runId, error: message } });
        return {
          runId,
          status: "failed",
          output: `The request failed: ${message}`,
          trace,
          artifacts: context.artifacts,
        };
      }
    },
  };
}
