import {
  AgentError,
  type JsonSchema,
  type ToolCall,
  type ToolResult,
  type ToolSchema,
} from "../core/types.ts";
import { validateAgainstSchema } from "./json-validator.ts";
import levenshtein from "fast-levenshtein";


export interface ToolContext {
  /** Absolute path all filesystem tools are confined to. */
  workspaceRoot: string;
  sessionId: string;
  /** Aborted on client disconnect, timeout, or budget exhaustion. */
  signal: AbortSignal;
  log: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface ToolOutput {
  /** Text handed back to the model. */
  content: string;
  /** Structured payload for the UI / audit log. Never sent to the model. */
  data?: Record<string, unknown>;
}

export interface ToolDefinition<TArgs = Record<string, unknown>> {
  name: string;
  description: string;
  tier: ToolSchema["tier"];
  /** JSON Schema for the arguments object. */
  parameters: JsonSchema;
  timeoutMs?: number;
  /** Cap on result size for this specific tool; falls back to the registry default. */
  maxResultChars?: number;
  handler: (args: TArgs, ctx: ToolContext) => Promise<ToolOutput> | ToolOutput;
}

/**
 * Identity helper that pins the argument type.
 *
 * The generic is what buys type safety without zod: declare the shape once and
 * the handler's `args` is fully typed, while validateAgainstSchema enforces the
 * same shape at runtime from `parameters`.
 */
export function defineTool<TArgs = Record<string, unknown>>(
  def: ToolDefinition<TArgs>,
): ToolDefinition<TArgs> {
  return def;
}

export interface RegistryOptions {
  defaultTimeoutMs?: number;
  defaultMaxResultChars?: number;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<never>>();
  private readonly defaultTimeoutMs: number;
  private readonly defaultMaxResultChars: number;

  constructor(opts: RegistryOptions = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
    // ~8k chars ≈ 2k tokens. Generous for one result, small enough that several
    // results still fit a 8k-context local model.
    this.defaultMaxResultChars = opts.defaultMaxResultChars ?? 8_000;
  }

  register<TArgs>(def: ToolDefinition<TArgs>): this {
    if (this.tools.has(def.name)) {
      throw new AgentError("TOOL_FAILED", `Duplicate tool registration: ${def.name}`);
    }
    if (!/^[a-z][a-z0-9_]*$/.test(def.name)) {
      // Some chat templates mangle names with dots or dashes.
      throw new AgentError(
        "TOOL_FAILED",
        `Tool name "${def.name}" must be snake_case (letters, digits, underscore).`,
      );
    }
    this.tools.set(def.name, def as unknown as ToolDefinition<never>);
    return this;
  }

  registerAll(defs: Array<ToolDefinition<never>>): this {
    for (const d of defs) this.register(d);
    return this;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** The catalogue as advertised to the model. */
  schemas(): ToolSchema[] {
    return [...this.tools.values()].map((t) => {
      const s: ToolSchema = {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
        tier: t.tier,
      };
      if (t.timeoutMs !== undefined) s.timeoutMs = t.timeoutMs;
      return s;
    });
  }

  /** Subset of the catalogue, for restricting a session to certain tools. */
  schemasFor(allowed: readonly string[]): ToolSchema[] {
    const set = new Set(allowed);
    return this.schemas().filter((s) => set.has(s.name));
  }

  /**
   * Execute a tool call. ALWAYS resolves — failures come back as
   * ToolResult.ok === false with model-readable error text.
   */
  async execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult> {
    const started = Date.now();
    const def = this.tools.get(call.name);

    if (!def) {
      const suggestion = nearestName(call.name, this.names());
      const hint = suggestion
        ? ` Did you mean "${suggestion}"?`
        : ` Available tools: ${this.names().join(", ")}.`;
      return {
        callId: call.id,
        name: call.name,
        ok: false,
        content: "",
        error: `No tool named "${call.name}".${hint}`,
        durationMs: Date.now() - started,
      };
    }

    // 1. Validate and coerce arguments.
    const validation = validateAgainstSchema(call.args, {
      ...def.parameters,
      type: "object",
    });
    if (!validation.ok) {
      return {
        callId: call.id,
        name: call.name,
        ok: false,
        content: "",
        // Include the schema so the model can correct itself in one step rather
        // than guessing across several.
        error:
          `Invalid arguments for ${call.name}: ${validation.errors.join("; ")}. ` +
          `Expected parameters: ${JSON.stringify(def.parameters)}`,
        durationMs: Date.now() - started,
      };
    }
    for (const note of validation.notes) ctx.log(`arg-coercion: ${call.name}: ${note}`);

    // 2. Run with a timeout linked to the caller's cancellation signal.
    const timeoutMs = def.timeoutMs ?? this.defaultTimeoutMs;
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([ctx.signal, timeoutSignal]);

    try {
      const output = await def.handler(validation.value as never, { ...ctx, signal });
      const max = def.maxResultChars ?? this.defaultMaxResultChars;
      const { text, truncated } = smartTruncate(output.content, max);

      return {
        callId: call.id,
        name: call.name,
        ok: true,
        content: text,
        durationMs: Date.now() - started,
        ...(truncated ? { truncated: true } : {}),
      };
    } catch (err) {
      const durationMs = Date.now() - started;

      if (timeoutSignal.aborted) {
        return {
          callId: call.id,
          name: call.name,
          ok: false,
          content: "",
          error: `Tool ${call.name} timed out after ${timeoutMs}ms. Try a narrower request.`,
          durationMs,
        };
      }
      if (ctx.signal.aborted) {
        return {
          callId: call.id,
          name: call.name,
          ok: false,
          content: "",
          error: `Tool ${call.name} was cancelled.`,
          durationMs,
        };
      }

      return {
        callId: call.id,
        name: call.name,
        ok: false,
        content: "",
        error: `Tool ${call.name} failed: ${err instanceof Error ? err.message : String(err)}`,
        durationMs,
      };
    }
  }
}

/**
 * Truncate from the MIDDLE, keeping head and tail.
 *
 * Head-only truncation is the obvious implementation and the wrong one: for
 * directory listings, logs, and stack traces the informative part is often at
 * the end. Keeping both ends and marking the gap preserves more signal per token.
 */
export function smartTruncate(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };

  const marker = "\n\n… [output truncated: %N% characters omitted] …\n\n";
  const budget = Math.max(0, maxChars - marker.length);
  const headLen = Math.ceil(budget * 0.7);
  const tailLen = budget - headLen;

  const head = text.slice(0, headLen);
  const tail = tailLen > 0 ? text.slice(text.length - tailLen) : "";
  const omitted = text.length - head.length - tail.length;

  return { text: head + marker.replace("%N%", String(omitted)) + tail, truncated: true };
}

/**
 * Levenshtein-based nearest match, used to turn "No tool named X" into a
 * self-correcting hint. Cheap, and it saves a whole loop iteration when the
 * model writes `readfile` instead of `read_file`.
 */
export function nearestName(input: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestScore = Infinity;
  for (const c of candidates) {
    const d = levenshtein.get(input.toLowerCase(), c.toLowerCase());
    if (d < bestScore) {
      bestScore = d;
      best = c;
    }
  }
  // Only suggest when it is plausibly a typo, not a wild guess.
  const threshold = Math.max(2, Math.floor(input.length / 3));
  return best !== null && bestScore <= threshold ? best : null;
}
