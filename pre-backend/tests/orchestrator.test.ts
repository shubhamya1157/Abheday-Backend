import test from "node:test";
import assert from "node:assert/strict";

import { classifyTask, type TaskProfile } from "../orchestartor/task-analyzer.js";
import { CapabilityRouter } from "../orchestartor/router.js";
import { createAgentOrchestrator, type AgentRequest } from "../orchestartor/orchestrator.js";

test("coding request routes to coding model", () => {
  const profile = classifyTask("Write a Python script to parse a CSV and save a report.");
  assert.equal(profile.taskType, "coding");
  assert.ok(profile.requiredCapabilities.includes("coding"));
});

test("vision request routes to a vision-capable model", async () => {
  const router = new CapabilityRouter([
    {
      id: "general",
      role: "general",
      capabilities: { reasoning: 2, coding: 1, vision: 0, document: 0, toolCalling: true },
      contextWindow: 32768,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalling: true,
      endpoint: "local://general",
      runtime: "llama.cpp",
      enabled: true,
    },
    {
      id: "vision",
      role: "vision",
      capabilities: { reasoning: 3, coding: 0, vision: 5, document: 2, toolCalling: false },
      contextWindow: 32768,
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      toolCalling: false,
      endpoint: "local://vision",
      runtime: "llama.cpp",
      enabled: true,
    }
  ]);

  const profile = classifyTask("Describe the inspection image and summarize issues.");
  const selected = await router.route(profile, { runId: "r-1", request: {} as AgentRequest, messages: [], observations: [], toolCalls: [], artifacts: [], metadata: {}, status: "pending" } as any);

  assert.equal(selected.model.id, "vision");
  assert.ok(selected.reason.some((item) => item.includes("vision")) || selected.reason.length > 0);
});

test("direct answer orchestrator returns a guarded response", async () => {
  const orchestrator = createAgentOrchestrator({
    models: [{
      id: "general",
      role: "general",
      capabilities: { reasoning: 2, coding: 1, vision: 0, document: 0, toolCalling: true },
      contextWindow: 32768,
      inputModalities: ["text"],
      outputModalities: ["text"],
      toolCalling: true,
      endpoint: "local://general",
      runtime: "llama.cpp",
      enabled: true,
    }],
    modelGateway: {
      async generate(model, request) {
        return {
          text: `Answer: ${request.prompt}`,
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 10 },
          model: model.id,
        };
      }
    }
  });

  const result = await orchestrator.run({
    requestId: "req-1",
    userInput: "Explain the local agent lifecycle simply.",
    sessionId: "sess-1",
  });

  assert.equal(result.status, "completed");
  assert.ok(result.output.includes("Answer:"));
  assert.ok(result.trace.length > 0);
});
