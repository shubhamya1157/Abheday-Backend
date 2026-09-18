
// THE AGENTIC LOOP.
//take user input → ask the LLM → understand the LLM response → run tools if requested → guard everything → feed tool results 
// back to the LLM → repeat → produce final answer.

import { randomUUID } from "node:crypto";

import {
  AgentError,
  type GenerateRequest,
  type GenerateResult,
  type Message,
  type ModelProvider,
  type TokenUsage,
  type ToolCall,
  type ToolResult,
  type ToolSchema,
} from "../../core/types.ts";
import { GuardrailPipeline, type GuardStage, type PipelineResult } from "../guardrails/pipeline.ts";
import { buildToolCallGrammar } from "../../protocol/grammar.ts";
import type { ParsedTurn, ToolProtocol } from "../../protocol/types.ts";
import type { ToolRegistry } from "../../tools/registry.ts";
import { toolFormatCorrection } from "../../prompt/system-prompt.ts";
import {
  DEFAULT_CONTEXT_CONFIG,
  estimateConversationTokens,
  mechanicalSummary,
  needsCompaction,
  planCompaction,
  renderForSummary,
  summarisationPrompt,
  summaryMessage,
  type ContextConfig,
} from "../memory/context.ts";
import {
  EventFactory,
  type AgentEvent,
  type RunOutcome,
  type StopReason,
} from "./events.ts";

/* ------------------------------------------------------------------------- */
/* Configuration                                                              */
/* ------------------------------------------------------------------------- */

export interface LoopConfig {
  /** Hard cap on model round trips. */
  maxSteps: number;
  /**
   * How many times the same (name, args) pair may be requested before the loop
   * intervenes. Third identical request is intercepted at the default of 2.
   */
  repeatCallLimit: number;
  /** Corrective retries allowed for unparseable tool calls. */
  malformedRetryLimit: number;
  /** Attach a GBNF grammar on the corrective retry, when the server supports it. */
  useGrammarOnRetry: boolean;
  /** Set false when the server rejected `grammar` during capability probing. */
  serverSupportsGrammar: boolean;
  /** Emit text_delta events by streaming from the provider. */
  stream: boolean;
  /** On budget exhaustion, spend one more call to get a usable closing answer. */
  forceFinalAnswer: boolean;
  temperature: number;
  /** Per-call completion cap. */
  maxOutputTokens: number;
  /** Fixed seed for reproducible runs. */
  seed?: number;
  context: ContextConfig;
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxSteps: 12,
  repeatCallLimit: 2,
  malformedRetryLimit: 2,
  useGrammarOnRetry: true,
  serverSupportsGrammar: true,
  stream: false,
  forceFinalAnswer: true,
  temperature: 0.2,
  maxOutputTokens: 1_024,
  context: DEFAULT_CONTEXT_CONFIG,
};

export interface LoopDeps {
  provider: ModelProvider;
  registry: ToolRegistry;
  guardrails: GuardrailPipeline;
  protocol: ToolProtocol;
  /** Fully composed system prompt, including the protocol's tool section. */
  systemPrompt: string;
  workspaceRoot: string;
  config?: Partial<LoopConfig>;
  /** Injected for deterministic tests. */
  now?: () => Date;
  newRunId?: () => string;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface RunRequest {
  input: string;
  sessionId: string;
  /** Prior turns, excluding the system prompt. */
  history?: Message[];
  signal?: AbortSignal;
}





// The loop
// -> genrater [A normal function returns once. A generator can pause, give you a value, and continue later.]

/*

The * means:

"This function is a generator. It can pause and later continue from exactly where it stopped."
You can think of yield as saying:

"Stop here and give this value to whoever called me."
yield 1
   ↓
PAUSE

yield 2
   ↓
PAUSE

yield 3
   ↓
PAUSE

END

.next() tells the generator:

"Start/resume execution until you reach the next yield."
.value

The result of .next() is an object.
result.value
result.done

value contains whatever was produced by yield.
.done

.done tells you:

"Has the generator completely finished?"


function* numbers() {
  yield 10;
  yield 20;
  yield 30;
}

const gen = numbers();
Before calling .next()
function* numbers()
       │
       ▼
     gen
       │
       ▼
  Ready to start

Nothing has executed yet.

Result:

{
  value: 10,
  done: false
}

The function is now paused.

yield 10
   │
   ▼
 PAUSED


gen.next();

It doesn't start from the beginning.

This is very important.

It continues from where it stopped:

*/


export async function* runAgent(
  deps: LoopDeps,
  req: RunRequest,
): AsyncGenerator<AgentEvent, RunOutcome, void> {

  const cfg: LoopConfig = { ...DEFAULT_LOOP_CONFIG, ...(deps.config ?? {}) };
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const events = new EventFactory(now);
  const runId = (deps.newRunId ?? defaultRunId)();
  const startedAt = Date.now();



  const tools: ToolSchema[] = deps.registry.schemas();
  const toolNames = tools.map((t) => t.name);




  const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let toolCallCount = 0;
  let steps = 0;
  let lastText = "";





  const callSignatures = new Map<string, number>();
  let interventions = 0;
  let malformedRetries = 0;
  let attachGrammarNextTurn = false;

  
  
  
/*
meta: { pinned: true } is a protection shield:

It tells the context memory manager: "This message is critical. 
No matter how full the token window gets, NEVER delete or summarize this message."

*/


/*

/// how much previous history go with current chat 

[Pinned System Prompt]
      +
[Original Task]
      +
[Summarized middle conversation] ◄── Old messages compressed into 1 short paragraph
      +
[Last 6 recent messages verbatim]
      +
[New user question]


*/
  const messages: Message[] = [
    { role: "system", content: deps.systemPrompt, meta: { pinned: true } },
    ...(req.history ?? []),
  ];

  yield events.make("run_start", { runId, input: req.input, model: deps.provider.id });




//Input guarrails

  const inputGuard = await deps.guardrails.run({
    stage: "user_input",
    text: req.input,
    sessionId: req.sessionId,
  });




  // If there is voilance in input stop and send outcome
  for (const e of guardEvents(events, "user_input", inputGuard)) yield e;
  if (inputGuard.action === "block") {
    const outcome = finish("blocked", inputGuard.reason ?? "input blocked by policy", {
      code: "GUARDRAIL_BLOCKED",
      message: inputGuard.reason ?? "input blocked by policy",
    });
    yield events.make("run_end", { runId, outcome });
    return outcome;
  }





// Now sending input in message array
// loop counting here : meta: { step: 0 } }
  messages.push({ role: "user", content: inputGuard.text, meta: { step: 0 } });


  let stopReason: StopReason | null = null;
  let errorInfo: { code: string; message: string } | undefined;





  /// NOW THE REAL LOPP BEGAIN

  while (stopReason === null) {




    // If i  close the tab stop the loop to for optimisation
    if (req.signal?.aborted) {
      stopReason = "aborted";
      break;
    }


    // Max loop sa jada step hoga to break it 
    if (steps >= cfg.maxSteps) {
      stopReason = "max_steps";
      break;
    }


    //incressing step by one 
    steps += 1;

    // Return this outocome first and pause here 
    yield events.make("step_start", { step: steps });

   


    
    if (needsCompaction(messages, cfg.context)) {
      for await (const e of compact(messages, cfg, deps, events, req)) yield e;
    }




    // In AI models, Temperature controls the "creativity vs. accuracy" knob of the LLM.
     //It is a number between 0.0 and 1.0 (our app uses 0.2 by default).
     //llama.cpp will use its own default (which is usually 0.8).

     /* ❌ It might invent non-existent file paths.
❌ It might make syntax mistakes in tool calls (broken JSON).
❌ It might repeat itself or wander off-topi*/


// signal for close tab

// seed -> 





    const baseReq: GenerateRequest = {
      messages: [...messages],
      temperature: cfg.temperature,
      maxTokens: cfg.maxOutputTokens,
      ...(cfg.seed !== undefined ? { seed: cfg.seed } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
    };





    // tool related 






    let genReq = deps.protocol.prepare(baseReq, tools);

    if (attachGrammarNextTurn && cfg.serverSupportsGrammar && tools.length > 0) {
      // Grammar is a REPAIR path, never always-on: a tool-call grammar makes a
      // prose reply unrepresentable, so the model could never finish the task.
      const grammar = buildToolCallGrammar(tools, {
        wrapInTags: deps.protocol.mode === "prompted",
      });
      if (grammar !== null) {
        genReq = { ...genReq, grammar };
        yield events.make("notice", {
          level: "info",
          message: "constrained decoding enabled for this turn to repair tool-call syntax",
        });
      }
    }
    attachGrammarNextTurn = false;

    let result: GenerateResult;
    try {
      if (cfg.stream) {
        const streamed = yield* streamStep(deps.provider, genReq, events, steps);
        result = streamed;
      } else {
        result = await deps.provider.generate(genReq);
      }
    } catch (err) {
      if (err instanceof AgentError && err.code === "EGRESS_BLOCKED") {
        stopReason = "blocked";
        errorInfo = { code: err.code, message: err.message };
        break;
      }
      if (req.signal?.aborted) {
        stopReason = "aborted";
        break;
      }
      stopReason = "error";
      errorInfo = {
        code: err instanceof AgentError ? err.code : "PROVIDER_ERROR",
        message: err instanceof Error ? err.message : String(err),
      };
      break;
    }

    accumulate(usage, result.usage);






////
    const parsed: ParsedTurn = deps.protocol.parse(result);




    for (const note of parsed.notes) {
      yield events.make("notice", { level: "info", message: `protocol: ${note}`, detail: { step: steps } });
      log("protocol note", { note, step: steps });
    }

    // Output Guardrails 
    const outputGuard = await deps.guardrails.run({
      stage: "model_output",//genrated by
      text: parsed.text,// the actual output 
      sessionId: req.sessionId,
    });


    for (const e of guardEvents(events, "model_output", outputGuard)) yield e;

    if (outputGuard.action === "block") {
      // Fail closed: if what the model produced cannot be shown, the run ends.
      // Continuing would keep the unshowable text in the context and risk it
      // reappearing in the next turn.
      lastText = outputGuard.text;
      stopReason = "blocked";
      errorInfo = {
        code: "GUARDRAIL_BLOCKED",
        message: outputGuard.reason ?? "model output blocked by policy",
      };
      break;
    }







    const text = outputGuard.text;
    const calls = parsed.toolCalls;









    //Handling a Model Response With No Tool Calls
   // Giant cloud models (like GPT-4 or Claude) have hundreds of billions of parameters fine-tuned specifically for tool calling.
//. Gemma 3 1B is a lightweight, super-fast 1-billion parameter model. While it is great at text, producing 100% mathematically valid JSON while thinking about reasoning is harder for a small model.
    //There are three case for low weight model

    if (calls.length === 0) {
      const empty = text.trim().length === 0;


      // It define the the pattren so we can predict it was tool calling
      const diagnosis: "malformed" | "empty" | null = parsed.malformedAttempt
        ? "malformed"
        : empty
          ? "empty"
          : null;



      // To prvent infinite loop 
      if (diagnosis !== null && malformedRetries < cfg.malformedRetryLimit) {
        malformedRetries += 1;
        //useGrammarOnRetry: true uses Grammar ONLY when a repair is needed:
        attachGrammarNextTurn = cfg.useGrammarOnRetry && diagnosis === "malformed";

       


        //model needs to see what it did wrong.
        messages.push({
          role: "assistant",
          content: result.text,
          meta: { step: steps },
        });

        //"This message was generated by our agent program, not by the real user." -> hardcoded
        messages.push({
          role: "user",
          content:
            diagnosis === "malformed"
              ? toolFormatCorrection(deps.protocol, toolNames)
              : "You returned an empty message. Either call a tool or answer the question.",
          meta: { step: steps, synthetic: true },
        });






        //Tell this event outside
        yield events.make("notice", {
          level: "warn",
          message:
            diagnosis === "malformed"
              ? `unparseable tool call at step ${steps}; injecting format correction (retry ${malformedRetries}/${cfg.malformedRetryLimit})`
              : `empty completion at step ${steps}; nudging (retry ${malformedRetries}/${cfg.malformedRetryLimit})`,
        });

        //repet again Like a -> loop 
        continue;
      }




      // Stop the loop someting went wrong
      if (empty) {
        stopReason = "error";
        errorInfo = {
          code: "PROTOCOL_UNPARSEABLE",
          message: `model returned no usable output after ${malformedRetries} corrective retries`,
        };
        break;
      }



      // sending final output
      lastText = text;
      messages.push({ role: "assistant", content: text, meta: { step: steps } });
      yield events.make("assistant_message", {
        step: steps,
        text,
        finishReason: result.finishReason,
        ...(result.usage ? { usage: result.usage } : {}),
      });
      stopReason = "completed";
      break;
    }


















  // The actual llm call
    malformedRetries = 0;
    // the text genrated with tool call
    if (text.trim().length > 0) lastText = text;



    //push in message so it uderstand beeter about why tool call
    messages.push({
      role: "assistant",
      content: text,
      toolCalls: calls,
      meta: { step: steps },
    });



    // return it and puse here
    yield events.make("assistant_message", {
      step: steps,
      text,
      // why i stop 
      finishReason: result.finishReason,
      //Token tracking
      ...(result.usage ? { usage: result.usage } : {}),
    });





    for (const call of calls) {
      //Store to chek does call the same tool and same argument
      const sig = callSignature(call);
      const seen = (callSignatures.get(sig) ?? 0) + 1;
      callSignatures.set(sig, seen);

      //Limitation check how much time same tool and same argument is call
      //Limit -> 2

      if (seen > cfg.repeatCallLimit) {
        interventions += 1;

        // Making tool result
        //The tool is not executed.
        const synthetic: ToolResult = {
          callId: call.id,
          name: call.name,
          ok: false,
          content: "",
          error:
            `Not executed. You have requested ${call.name} with identical arguments ` +
            `${seen} times and the outcome cannot change. Do something different: use ` +
            `different arguments, use a different tool, or stop and explain what is ` +
            `blocking you.`,
          durationMs: 0,
        };


        yield events.make("tool_call", { step: steps, call });
        yield events.make("tool_result", { step: steps, call, result: synthetic, durationMs: 0 });


        messages.push(deps.protocol.formatToolResult(synthetic));


        //Secind layer of protection
        if (interventions > 2) {
          stopReason = "no_progress";
          errorInfo = {
            code: "NO_PROGRESS",
            message: `run stopped after ${interventions} repeated identical tool calls`,
          };
        }
        continue;
      }

      // tool_args — the only stage where refusing has any effect.
      const argsGuard = await deps.guardrails.run({
        stage: "tool_args",
        text: JSON.stringify(call.args),
        sessionId: req.sessionId,
        toolName: call.name,
        toolArgs: call.args,
        ...(tierOf(tools, call.name) ? { toolTier: tierOf(tools, call.name)! } : {}),
      });
      for (const e of guardEvents(events, "tool_args", argsGuard)) yield e;

      if (argsGuard.action === "block") {
        const blocked: ToolResult = {
          callId: call.id,
          name: call.name,
          ok: false,
          content: "",
          // The model must learn WHY, or it will retry the same call.
          error: `Refused by policy: ${argsGuard.reason ?? "not permitted"}. Do not retry this call.`,
          durationMs: 0,
          guardrailAction: "blocked",
        };
        yield events.make("tool_call", { step: steps, call });
        yield events.make("tool_result", { step: steps, call, result: blocked, durationMs: 0 });
        messages.push(deps.protocol.formatToolResult(blocked));
        continue;
      }

      let effectiveCall = call;
      if (argsGuard.action === "sanitize" && argsGuard.text !== JSON.stringify(call.args)) {
        // A guard rewrote the arguments. Only honour it if the result is still a
        // JSON object — a mangled rewrite must not silently become {}.
        try {
          const reparsed: unknown = JSON.parse(argsGuard.text);
          if (reparsed !== null && typeof reparsed === "object" && !Array.isArray(reparsed)) {
            effectiveCall = { ...call, args: reparsed as Record<string, unknown> };
          } else {
            yield events.make("notice", {
              level: "warn",
              message: `guardrail rewrote ${call.name} arguments to a non-object; original arguments kept`,
            });
          }
        } catch {
          yield events.make("notice", {
            level: "warn",
            message: `guardrail rewrote ${call.name} arguments to invalid JSON; original arguments kept`,
          });
        }
      }

      yield events.make("tool_call", { step: steps, call: effectiveCall });

      const toolStarted = Date.now();
      const execResult = await deps.registry.execute(effectiveCall, {
        workspaceRoot: deps.workspaceRoot,
        sessionId: req.sessionId,
        signal: req.signal ?? neverAborts(),
        log: (msg, extra) => log(msg, { ...extra, tool: call.name, step: steps }),
      });
      toolCallCount += 1;

      // tool_result — the injection surface most implementations leave open.
      const inspected = execResult.ok ? execResult.content : (execResult.error ?? "");
      const resultGuard = await deps.guardrails.run({
        stage: "tool_result",
        text: inspected,
        sessionId: req.sessionId,
        toolName: call.name,
        toolArgs: effectiveCall.args,
        ...(tierOf(tools, call.name) ? { toolTier: tierOf(tools, call.name)! } : {}),
      });
      for (const e of guardEvents(events, "tool_result", resultGuard)) yield e;

      const finalResult: ToolResult = { ...execResult };
      if (resultGuard.action === "block") {
        // Not fatal. The model is told the content was withheld and can proceed;
        // ending the run because one file was unreadable would be brittle.
        finalResult.ok = false;
        finalResult.content = "";
        finalResult.error = `Content withheld by policy: ${resultGuard.reason ?? "blocked"}.`;
        finalResult.guardrailAction = "blocked";
      } else if (resultGuard.action === "sanitize") {
        if (execResult.ok) finalResult.content = resultGuard.text;
        else finalResult.error = resultGuard.text;
        finalResult.guardrailAction = "sanitized";
      } else {
        finalResult.guardrailAction = "allow";
      }

      yield events.make("tool_result", {
        step: steps,
        call: effectiveCall,
        result: finalResult,
        durationMs: Date.now() - toolStarted,
      });
      messages.push(deps.protocol.formatToolResult(finalResult));

      if (req.signal?.aborted) {
        stopReason = "aborted";
        break;
      }
    }
  }

  /* --- 3. Closing answer on budget exhaustion ---------------------------- */

//The agent has stopped because it reached a limit or got stuck. Before completely ending the run,
//  this code optionally gives the LLM one final chance to produce a useful answer for the user.

  if (
    cfg.forceFinalAnswer &&
    (stopReason === "max_steps" || stopReason === "no_progress") &&
    !req.signal?.aborted
  ) {
    try {
      const closing = await forceClose(deps, messages, cfg, req, stopReason);
      accumulate(usage, closing.usage);
      const guard = await deps.guardrails.run({
        stage: "model_output",
        text: closing.text,
        sessionId: req.sessionId,
      });
      for (const e of guardEvents(events, "model_output", guard)) yield e;
      if (guard.action !== "block" && guard.text.trim().length > 0) {
        lastText = guard.text;
        yield events.make("assistant_message", {
          step: steps,
          text: guard.text,
          finishReason: closing.finishReason,
          usage: closing.usage,
        });
      }
    } catch (err) {
      // A failed wrap-up must not change the run's verdict.
      yield events.make("notice", {
        level: "warn",
        message: `could not obtain a closing summary: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  const outcome = finish(stopReason ?? "error", lastText, errorInfo);
  yield events.make("run_end", { runId, outcome });
  return outcome;

  /* --- helpers closing over run state ------------------------------------ */

  function finish(
    reason: StopReason,
    text: string,
    error?: { code: string; message: string },
  ): RunOutcome {
    const out: RunOutcome = {
      runId,
      stopReason: reason,
      text: text.length > 0 ? text : fallbackText(reason, error),
      steps,
      toolCallCount,
      usage: { ...usage },
      durationMs: Date.now() - startedAt,
    };
    if (error) out.error = error;
    return out;
  }
}

/* ------------------------------------------------------------------------- */
/* Sub-steps                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Drain a streaming response, emitting deltas, and return the final result.
 *
 * Uses `yield*` from the caller so the deltas interleave with the run's other
 * events in true order — buffering them and emitting later would make the SSE
 * stream feel synchronous and would misorder the audit log.
 */
async function* streamStep(
  provider: ModelProvider,
  genReq: GenerateRequest,
  events: EventFactory,
  step: number,
): AsyncGenerator<AgentEvent, GenerateResult, void> {
  let final: GenerateResult | null = null;

  for await (const chunk of provider.stream(genReq)) {
    if (chunk.kind === "text" && chunk.delta.length > 0) {
      yield events.make("text_delta", { step, text: chunk.delta });
    } else if (chunk.kind === "done") {
      final = chunk.result;
    }
  }

  if (!final) {
    throw new AgentError("PROVIDER_ERROR", "stream ended without a final result");
  }
  return final;
}

/**
 * Compact the conversation in place.
 *
 * Summarisation uses the same provider with tools switched off. If it fails for
 * any reason we fall back to a mechanical summary rather than either crashing or
 * silently dropping history — an agent that quietly forgets is worse than one
 * that says it forgot.
 */
async function* compact(
  messages: Message[],
  cfg: LoopConfig,
  deps: LoopDeps,
  events: EventFactory,
  req: RunRequest,
): AsyncGenerator<AgentEvent, void, void> {
  const before = estimateConversationTokens(messages);
  const plan = planCompaction(messages, cfg.context);

  if (plan.middle.length === 0) {
    yield events.make("notice", {
      level: "warn",
      message:
        "context is over budget but nothing is eligible for compaction; " +
        "the pinned head and recent tail alone exceed the window",
    });
    return;
  }

  let summary: string;
  let method: "model" | "mechanical" = "model";
  try {


    const res = await deps.provider.generate({

      messages: [
        {
          role: "system",
          content: "You summarise agent transcripts precisely and compactly. No preamble.",
        },
        { role: "user", content: summarisationPrompt(renderForSummary(plan.middle)) },
      ],
      temperature: 0,
      maxTokens: 512,
      ...(req.signal ? { signal: req.signal } : {}),
    });
    summary = res.text.trim();
    if (summary.length === 0) throw new Error("summariser returned nothing");
  } catch (err) {
    summary = mechanicalSummary(plan.middle);
    method = "mechanical";
    yield events.make("notice", {
      level: "warn",
      message: `summariser unavailable, used mechanical summary: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  const rebuilt = [...plan.head, summaryMessage(summary), ...plan.tail];
  messages.length = 0;
  messages.push(...rebuilt);

  yield events.make("compaction", {
    droppedMessages: plan.middle.length,
    tokensBefore: before,
    tokensAfter: estimateConversationTokens(messages),
    method,
  });
}

/**
 * One last call with tools removed, to turn "ran out of steps" into something
 * the operator can actually use. Tools are omitted so the model cannot start
 * more work it has no budget to finish.
 */
async function forceClose(
  deps: LoopDeps,
  messages: readonly Message[],
  cfg: LoopConfig,
  req: RunRequest,
  reason: StopReason,
): Promise<GenerateResult> {
  const why =
    reason === "max_steps"
      ? "You have used all available steps."
      : reason === "token_budget"
        ? "You have used the available token budget."
        : "You are repeating actions without making progress.";



  return deps.provider.generate({



    messages: [
      ...messages,
      {
        role: "user",
        content: [
          `${why} Stop working now and write your final report.`,
          "",
          "State plainly: what you established, which files you read or changed (with paths),",
          "what remains unfinished, and the single next step you would take.",
          "Do not call any tools. Do not claim anything you did not verify.",
        ].join("\n"),
        meta: { synthetic: true },
      },
    ],
    temperature: cfg.temperature,
    maxTokens: cfg.maxOutputTokens,
    ...(req.signal ? { signal: req.signal } : {}),
  });
}

/* ------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* ------------------------------------------------------------------------- */

function* guardEvents(
  events: EventFactory,
  stage: GuardStage,
  result: PipelineResult,
): Generator<AgentEvent, void, void> {
  for (const entry of result.trace) {
    if (entry.action === "allow") continue;
    yield events.make("guardrail", {
      stage,
      guard: entry.guard,
      action: entry.action,
      reason: entry.reason ?? "(no reason given)",
      ...(entry.action === "block" ? { fatal: stage !== "tool_result" } : {}),
    });
  }
}

/**
 * Stable identity for a tool call.
 *
 * Keys are sorted so `{a:1,b:2}` and `{b:2,a:1}` are the same action — without
 * that, a model that reorders its JSON keys defeats repeat detection entirely.
 */
export function callSignature(call: ToolCall): string {
  return `${call.name}(${canonicalJson(call.args)})`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function accumulate(total: TokenUsage, add: TokenUsage | undefined): void {
  if (!add) return;
  total.promptTokens += add.promptTokens ?? 0;
  total.completionTokens += add.completionTokens ?? 0;
  total.totalTokens += add.totalTokens ?? 0;
}

function tierOf(
  tools: readonly ToolSchema[],
  name: string,
): "read" | "write" | "execute" | undefined {
  return tools.find((t) => t.name === name)?.tier;
}

function neverAborts(): AbortSignal {
  return new AbortController().signal;
}




// Generating id for loop using UUID
function defaultRunId(): string {
  return `run_${randomUUID()}`;
}




function fallbackText(reason: StopReason, error?: { message: string }): string {
  switch (reason) {
    case "aborted":
      return "Run cancelled.";
    case "max_steps":
      return "Stopped after reaching the step limit without completing the task.";
    case "token_budget":
      return "Stopped after exhausting the token budget without completing the task.";
    case "timeout":
      return "Stopped after exceeding the time limit without completing the task.";
    case "no_progress":
      return "Stopped: the same action was being repeated without progress.";
    case "blocked":
      return error?.message ?? "Blocked by policy.";
    case "error":
      return `Run failed: ${error?.message ?? "unknown error"}`;
    case "completed":
      return "(no output)";
  }
}
