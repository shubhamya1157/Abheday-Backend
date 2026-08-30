/**
 * PROMPTED tool-call protocol.
 *
 * Tool docs go into the system prompt; the model emits
 *
 *     <tool_call>{"name": "read_file", "arguments": {"path": "a.txt"}}</tool_call>
 *
 * FORMAT CHOICE. This is the Hermes / Qwen tool-call format, chosen on purpose
 * rather than inventing our own tags. Qwen2.5/Qwen3, Hermes fine-tunes, and many
 * Mistral and Llama derivatives have this exact syntax in their instruction
 * tuning data. Matching the training distribution is worth more than any prompt
 * engineering: the model is reproducing a pattern it already knows instead of
 * following novel instructions. If you switch base models, check its chat
 * template and change TAG_ALIASES to match — that is the single highest-leverage
 * reliability knob in this whole repo.
 *
 * Parsing is deliberately permissive. Small models drift between
 * <tool_call>, <tool-call>, [TOOL_CALL], and ```json fences even within one
 * session, so we accept all of them and record which alias was seen.
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
import { defaultIdFactory, type IdFactory, type ParsedTurn, type ToolProtocol } from "./types.ts";

/** Canonical tags we emit in the prompt. */
export const OPEN_TAG = "<tool_call>";
export const CLOSE_TAG = "</tool_call>";

/**
 * Aliases we ACCEPT when parsing. Order matters only for reporting.
 * Each entry is [openPattern, closePattern, label].
 */
const TAG_ALIASES: Array<[string, string, string]> = [
  ["<tool_call>", "</tool_call>", "tool_call"],
  ["<tool-call>", "</tool-call>", "tool-call"],
  ["<function_call>", "</function_call>", "function_call"],
  ["<tool▁call>", "</tool▁call>", "deepseek-tool_call"],
  ["[TOOL_CALL]", "[/TOOL_CALL]", "bracket-TOOL_CALL"],
  ["[TOOL_CALLS]", "[/TOOL_CALLS]", "bracket-TOOL_CALLS"],
];

export interface PromptedProtocolOptions {
  idFactory?: IdFactory;
  /**
   * Add CLOSE_TAG as a stop sequence. Saves tokens on verbose models but breaks
   * multi-call turns, because generation halts after the first call. Off by
   * default: one extra tool round-trip is cheaper than losing parallel calls.
   */
  useStopSequence?: boolean;
  /** Cap on calls accepted from a single turn, to bound tool fan-out. */
  maxCallsPerTurn?: number;
}

export class PromptedToolProtocol implements ToolProtocol {
  readonly mode = "prompted" as const;
  private readonly idFactory: IdFactory;
  private readonly useStopSequence: boolean;
  private readonly maxCallsPerTurn: number;

  constructor(opts: PromptedProtocolOptions = {}) {
    this.idFactory = opts.idFactory ?? defaultIdFactory;
    this.useStopSequence = opts.useStopSequence ?? false;
    this.maxCallsPerTurn = opts.maxCallsPerTurn ?? 4;
  }

  prepare(req: GenerateRequest, _tools: readonly ToolSchema[]): GenerateRequest {
    // Deliberately do NOT set req.tools — in prompted mode the catalogue lives
    // in the system prompt. Sending both confuses templates that support native
    // calling and doubles the token cost of the tool descriptions.
    if (!this.useStopSequence) return req;
    return { ...req, stop: [...(req.stop ?? []), CLOSE_TAG] };
  }

  systemPromptSection(tools: readonly ToolSchema[]): string {
    if (tools.length === 0) return "";

    const catalogue = tools
      .map((t) => {
        // Compact JSON: pretty-printing the schema can triple prompt tokens,
        // which matters a lot when running CPU-only inference.
        const schema = JSON.stringify(t.parameters);
        return `- ${t.name} (${t.tier}): ${t.description}\n  parameters: ${schema}`;
      })
      .join("\n");

    return [
      "# Tools",
      "",
      "You can call tools to inspect and change the workspace. Available tools:",
      "",
      catalogue,
      "",
      "## Calling a tool",
      "",
      `Emit a call as a single line wrapped in ${OPEN_TAG} and ${CLOSE_TAG}:`,
      "",
      `${OPEN_TAG}{"name": "<tool name>", "arguments": {<json arguments>}}${CLOSE_TAG}`,
      "",
      "Rules:",
      `1. "arguments" must be a JSON object matching that tool's parameters exactly.`,
      "2. Use double quotes. Do not wrap the call in markdown code fences.",
      "3. Stop generating immediately after the closing tag and wait for the result.",
      "4. Never invent a tool result. You will be given the real one.",
      "5. To answer the user directly, write prose with no tool-call tags at all.",
      `6. Emit at most ${this.maxCallsPerTurn} tool calls in one turn.`,
      "",
      "Example:",
      `${OPEN_TAG}{"name": "read_file", "arguments": {"path": "notes/spec.md"}}${CLOSE_TAG}`,
    ].join("\n");
  }

  parse(result: GenerateResult): ParsedTurn {
    const notes: string[] = [];
    const toolCalls: ToolCall[] = [];

    // A server may do native calling even in prompted mode (some templates
    // always inject tools). Accept it rather than discarding real work.
    if (result.toolCalls && result.toolCalls.length > 0) {
      notes.push("server returned native tool_calls while in prompted mode");
      for (const raw of result.toolCalls) {
        const parsed = parseJsonLoose(raw.argumentsJson);
        toolCalls.push(
          this.makeCall(raw.name, parsed.ok ? parsed.value : {}, raw.argumentsJson, parsed.repaired, raw.id),
        );
        notes.push(...parsed.repairs.map((r) => `${raw.name}: ${r}`));
      }
    }

    const extraction = extractTaggedCalls(result.text);
    notes.push(...extraction.notes);

    for (const block of extraction.blocks) {
      const parsed = parseJsonLoose(block.body);
      if (!parsed.ok) {
        notes.push(`unparseable tool call: ${parsed.error ?? "unknown"}`);
        continue;
      }
      const obj = asRecord(parsed.value);
      if (!obj) {
        notes.push("tool call payload was not a JSON object");
        continue;
      }

      const name = pickString(obj, ["name", "tool", "tool_name", "function"]);
      if (!name) {
        notes.push('tool call missing a "name" field');
        continue;
      }

      // Accept "arguments", "args", "parameters", "input" — models mix these up.
      const argsRaw =
        obj["arguments"] ?? obj["args"] ?? obj["parameters"] ?? obj["input"] ?? {};
      let args = asRecord(argsRaw);
      if (!args) {
        if (typeof argsRaw === "string") {
          // Double-encoded arguments: {"arguments": "{\"path\":\"a\"}"}
          const inner = parseJsonLoose(argsRaw);
          args = asRecord(inner.value) ?? {};
          notes.push(`${name}: decoded double-encoded arguments string`);
        } else {
          args = {};
          notes.push(`${name}: arguments were not an object, defaulted to {}`);
        }
      }

      if (parsed.repaired) notes.push(...parsed.repairs.map((r) => `${name}: ${r}`));
      toolCalls.push(this.makeCall(name, args, block.raw, parsed.repaired));
    }

    const capped = toolCalls.slice(0, this.maxCallsPerTurn);
    if (toolCalls.length > capped.length) {
      notes.push(`discarded ${toolCalls.length - capped.length} calls over the per-turn cap`);
    }

    return {
      text: extraction.prose,
      toolCalls: capped,
      notes,
      // Tell the loop to issue a format-correction retry when the model clearly
      // aimed at a tool call but nothing usable survived — including the case
      // where a block extracted but its JSON was beyond repair.
      malformedAttempt:
        capped.length === 0 && (extraction.looksLikeAttempt || extraction.blocks.length > 0),
    };
  }

  formatToolResult(result: ToolResult): Message {
    // User role, not tool role — see the note in protocol/types.ts. Many GGUF
    // chat templates have no {% if role == 'tool' %} branch and will silently
    // drop the message, leaving the model to hallucinate the result.
    const status = result.ok ? "ok" : "error";
    const payload = result.ok ? result.content : (result.error ?? "tool failed");
    const truncNote = result.truncated ? " (truncated)" : "";

    return {
      role: "user",
      content:
        `<tool_result name="${result.name}" status="${status}"${truncNote ? ' truncated="true"' : ""}>\n` +
        `${payload}\n` +
        `</tool_result>`,
      meta: { pinned: false },
    };
  }

  private makeCall(
    name: string,
    args: unknown,
    raw: string,
    repaired: boolean,
    id?: string,
  ): ToolCall {
    const call: ToolCall = {
      id: id ?? this.idFactory(),
      name,
      args: asRecord(args) ?? {},
      raw,
    };
    if (repaired) call.repaired = true;
    return call;
  }
}

/* ------------------------------------------------------------------------- */
/* Tag extraction — pure, exported for direct unit testing                    */
/* ------------------------------------------------------------------------- */

export interface ExtractedBlock {
  body: string;
  raw: string;
  alias: string;
}

export interface TagExtraction {
  blocks: ExtractedBlock[];
  /** The text with all tool-call blocks removed. */
  prose: string;
  notes: string[];
  /** Heuristic: the model appears to have attempted a call and botched it. */
  looksLikeAttempt: boolean;
}

/**
 * Pull every tool-call block out of the model's text.
 *
 * Handles, in order of preference:
 *   1. Properly closed alias tags.
 *   2. An opening tag with no closing tag (truncated by max_tokens) — we take
 *      the balanced JSON that follows, which is usually complete even when the
 *      tag is not.
 *   3. A bare fenced ```json block whose object has name+arguments keys.
 */
export function extractTaggedCalls(text: string): TagExtraction {
  const blocks: ExtractedBlock[] = [];
  const notes: string[] = [];
  let prose = text;

  for (const [open, close, alias] of TAG_ALIASES) {
    for (;;) {
      const start = prose.indexOf(open);
      if (start === -1) break;

      const afterOpen = start + open.length;
      const end = prose.indexOf(close, afterOpen);

      if (end === -1) {
        // Unclosed tag. Recover the JSON body up to end of text.
        const body = prose.slice(afterOpen);
        blocks.push({ body, raw: prose.slice(start), alias });
        notes.push(`recovered unclosed ${alias} block (model output was cut off)`);
        prose = prose.slice(0, start);
        break;
      }

      const body = prose.slice(afterOpen, end);
      blocks.push({ body, raw: prose.slice(start, end + close.length), alias });
      if (alias !== "tool_call") notes.push(`accepted non-canonical tag alias "${alias}"`);
      prose = prose.slice(0, start) + prose.slice(end + close.length);
    }
  }

  // Fallback: a fenced JSON object shaped like a tool call, with no tags at all.
  if (blocks.length === 0) {
    const fence = /```(?:json)?\s*\n?([\s\S]*?)```/g;
    let m: RegExpExecArray | null = fence.exec(prose);
    while (m !== null) {
      const body = m[1];
      if (body && /"(?:name|tool|tool_name)"\s*:/.test(body) && /"(?:arguments|args|parameters|input)"\s*:/.test(body)) {
        blocks.push({ body, raw: m[0], alias: "json-fence" });
        notes.push("accepted a fenced JSON object as a tool call (tags were missing)");
        prose = prose.replace(m[0], "");
      }
      m = fence.exec(prose);
    }
  }

  // Evidence that the model was *trying* to call a tool, independent of whether
  // we managed to extract anything usable. Callers combine this with their own
  // "did any call survive validation" check — a block that extracted but failed
  // to parse is still a malformed attempt and must trigger a correction retry.
  const looksLikeAttempt =
    /<\s*\/?\s*tool[_\-▁]?call/i.test(text) ||
    /\[\/?TOOL_CALLS?\]/i.test(text) ||
    /"(?:name|tool_name)"\s*:\s*"/.test(text);

  return { blocks, prose: prose.trim(), notes, looksLikeAttempt };
}

/* ------------------------------------------------------------------------- */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    // Some models emit {"function": {"name": "x"}}
    const nested = asRecord(v);
    if (nested && typeof nested["name"] === "string") return nested["name"].trim();
  }
  return null;
}
