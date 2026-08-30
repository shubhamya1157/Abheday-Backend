/**
 * Tool-call protocol abstraction.
 *
 * The agent loop must not care HOW a tool call travelled from the model. Two
 * implementations exist:
 *
 *   native.ts    — server-side function calling via the `tools` REST field.
 *   prompted.ts  — tool docs inlined in the system prompt, calls emitted as
 *                  <tool_call>{...}</tool_call> text blocks that we parse.
 *
 * Having both is not gold-plating. Native support across llama.cpp builds,
 * LM Studio versions, and GGUF chat templates is genuinely inconsistent: the
 * same 7B model will honour `tools` under one chat template and silently ignore
 * it under another. A config flag that swaps protocols turns a demo-killing
 * incident into a one-line change. It also means a teammate can develop against
 * whatever server they happen to have running.
 */

import type {
  GenerateRequest,
  GenerateResult,
  Message,
  ToolCall,
  ToolResult,
  ToolSchema,
} from "../core/types.ts";

/** The model's reply, decomposed. */
export interface ParsedTurn {
  /** Prose intended for the user, with tool-call syntax removed. */
  text: string;
  toolCalls: ToolCall[];
  /** Diagnostics recorded in the Trust Receipt (repairs, aliases, oddities). */
  notes: string[];
  /**
   * True when the model clearly *tried* to call a tool but we could not recover
   * a usable call. The loop uses this to trigger a corrective retry rather than
   * treating the garbled text as a final answer.
   */
  malformedAttempt: boolean;
}

export interface ToolProtocol {
  readonly mode: "native" | "prompted";

  /**
   * Last-mile mutation of the request before it hits the provider.
   * Native attaches `tools`; prompted leaves it off and may add stop sequences.
   */
  prepare(req: GenerateRequest, tools: readonly ToolSchema[]): GenerateRequest;

  /**
   * Protocol-specific text appended to the system prompt.
   * Native returns a short discipline note; prompted returns the full tool
   * catalogue and emission rules.
   */
  systemPromptSection(tools: readonly ToolSchema[]): string;

  /** Decompose a completion into prose plus normalised tool calls. */
  parse(result: GenerateResult): ParsedTurn;

  /**
   * Render a tool result as a conversation message.
   *
   * This differs per protocol and it matters: native mode uses role:"tool" with
   * a tool_call_id, but many GGUF chat templates have no branch for the "tool"
   * role and will either drop the message or throw a template error. Prompted
   * mode therefore folds results into a user-role message instead.
   */
  formatToolResult(result: ToolResult): Message;
}

/** Injected so tests can produce deterministic call ids. */
export type IdFactory = () => string;

export const defaultIdFactory: IdFactory = () =>
  `call_${Math.random().toString(36).slice(2, 10)}`;
