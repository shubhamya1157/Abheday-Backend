/**
 * NATIVE tool-call protocol — server-side function calling via the REST
 * `tools` field, with `tool_calls` coming back on the message.
 *
 * Cheaper in tokens than the prompted protocol and usually more reliable,
 * because llama.cpp compiles the tool schema into a decoding grammar so the
 * arguments are structurally valid by construction.
 *
 * ONE DELIBERATE LENIENCY. Even with `tools` set, small models frequently
 * ignore the mechanism and type a <tool_call> block into the content instead —
 * whether they use the native path depends on the GGUF's chat template, which
 * we do not control. A strict implementation would treat that as a final
 * answer, hand the user a reply full of raw XML, and stall the task. So after
 * reading native tool_calls we ALSO scan the text, and record when we had to.
 * That note is a useful signal: if it fires constantly, the deployed template
 * does not really support native calling and you should switch to prompted mode.
 */

import type {
  GenerateRequest,
  GenerateResult,
  Message,
  ToolCall,
  ToolResult,
  ToolSchema,
} from "../core/types.ts";
import { parseJsonLoose } from "./json-repair.ts";
import { extractTaggedCalls } from "./prompted.ts";
import { defaultIdFactory, type IdFactory, type ParsedTurn, type ToolProtocol } from "./types.ts";

export interface NativeProtocolOptions {
  idFactory?: IdFactory;
  maxCallsPerTurn?: number;
  /** Set false to reject text-emitted calls and force strict native behaviour. */
  acceptTextFallback?: boolean;
}

export class NativeToolProtocol implements ToolProtocol {
  readonly mode = "native" as const;
  private readonly idFactory: IdFactory;
  private readonly maxCallsPerTurn: number;
  private readonly acceptTextFallback: boolean;

  constructor(opts: NativeProtocolOptions = {}) {
    this.idFactory = opts.idFactory ?? defaultIdFactory;
    this.maxCallsPerTurn = opts.maxCallsPerTurn ?? 4;
    this.acceptTextFallback = opts.acceptTextFallback ?? true;
  }

  prepare(req: GenerateRequest, tools: readonly ToolSchema[]): GenerateRequest {
    if (tools.length === 0) return req;
    return { ...req, tools: [...tools] };
  }

  systemPromptSection(tools: readonly ToolSchema[]): string {
    if (tools.length === 0) return "";
    // The schemas are already in the request payload, so repeating them here
    // would waste context. Only the *discipline* needs stating — small models
    // over-call tools and narrate calls they never make.
    return [
      "# Tools",
      "",
      "You have tools available through the function-calling interface.",
      "",
      "Rules:",
      "1. Call a tool by using the function-calling mechanism, not by writing the call as text.",
      "2. Never describe a call you have not made, and never invent a result.",
      "3. Prefer reading before writing. Verify a path exists before depending on it.",
      "4. When you have enough information, answer in prose and stop calling tools.",
      `5. Tools available: ${tools.map((t) => t.name).join(", ")}.`,
    ].join("\n");
  }

  parse(result: GenerateResult): ParsedTurn {
    const notes: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const raw of result.toolCalls ?? []) {
      const parsed = parseJsonLoose(raw.argumentsJson);
      if (!parsed.ok) {
        // Native path with unparseable args means the server's grammar was not
        // applied. Flag it rather than silently sending {} to the tool.
        notes.push(
          `native tool_call "${raw.name}" had unparseable arguments: ${parsed.error ?? "unknown"}`,
        );
        continue;
      }
      if (parsed.repaired) notes.push(...parsed.repairs.map((r) => `${raw.name}: ${r}`));

      const call: ToolCall = {
        id: raw.id ?? this.idFactory(),
        name: raw.name,
        args: asRecord(parsed.value) ?? {},
        raw: raw.argumentsJson,
      };
      if (parsed.repaired) call.repaired = true;
      toolCalls.push(call);
    }

    let prose = result.text;
    let malformedAttempt = false;

    if (this.acceptTextFallback) {
      const extraction = extractTaggedCalls(result.text);
      if (extraction.blocks.length > 0) {
        notes.push(
          `model emitted ${extraction.blocks.length} tool call(s) as text despite native tools ` +
            `being advertised — recovered them. Persistent occurrences mean this GGUF's chat ` +
            `template does not support native calling; switch TOOL_PROTOCOL to "prompted".`,
        );
        notes.push(...extraction.notes);
        prose = extraction.prose;

        for (const block of extraction.blocks) {
          const parsed = parseJsonLoose(block.body);
          const obj = parsed.ok ? asRecord(parsed.value) : null;
          const name = obj ? pickName(obj) : null;
          if (!obj || !name) {
            notes.push("could not recover a text-emitted tool call");
            continue;
          }
          const argsRaw = obj["arguments"] ?? obj["args"] ?? obj["parameters"] ?? obj["input"] ?? {};
          const call: ToolCall = {
            id: this.idFactory(),
            name,
            args: asRecord(argsRaw) ?? {},
            raw: block.raw,
            repaired: true,
          };
          toolCalls.push(call);
        }
      }

      // Nothing usable came out, but the model was visibly reaching for a tool.
      // Covers both "no block at all, just garbled text" and "block extracted
      // but its JSON was unrecoverable".
      if (toolCalls.length === 0 && (extraction.looksLikeAttempt || extraction.blocks.length > 0)) {
        malformedAttempt = true;
      }
    }

    const capped = toolCalls.slice(0, this.maxCallsPerTurn);
    if (toolCalls.length > capped.length) {
      notes.push(`discarded ${toolCalls.length - capped.length} calls over the per-turn cap`);
    }

    return { text: prose.trim(), toolCalls: capped, notes, malformedAttempt };
  }

  formatToolResult(result: ToolResult): Message {
    const msg: Message = {
      role: "tool",
      content: result.ok ? result.content : `ERROR: ${result.error ?? "tool failed"}`,
      toolCallId: result.callId,
      name: result.name,
    };
    return msg;
  }
}

/* ------------------------------------------------------------------------- */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function pickName(obj: Record<string, unknown>): string | null {
  for (const k of ["name", "tool", "tool_name", "function"]) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "object" && v !== null) {
      const n = (v as Record<string, unknown>)["name"];
      if (typeof n === "string" && n.trim()) return n.trim();
    }
  }
  return null;
}
