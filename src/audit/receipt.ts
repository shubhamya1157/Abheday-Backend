








// WE CAN ALSO IMPLEMENT IT USING HASH




//“What exactly happened during this agent run, what tools did it use, what policies were triggered, 
// what files/paths did it touch, and can we verify that the event sequence is structurally intact?

import type { AgentEvent, RunOutcome } from "../agent/events.ts";
import type { EgressAttestation } from "../net/egress-guard.ts";


export type { EgressAttestation };

/** A single log entry in the receipt. */
export interface ReceiptEntry {
  seq: number;
  at: string;
  type: AgentEvent["type"];
  summary: string;
  details?: Record<string, unknown>;
}




//The complete report card of one agent execution.
export interface TrustReceipt {
  runId: string;
  sessionId: string;
  model: string;
  startedAt: string;
  endedAt: string;
  input: string;
  outcome: RunOutcome;
  stats: ReceiptStats;
  egress?: EgressAttestation;
  entries: ReceiptEntry[];
}





//Final counting for the process
export interface ReceiptStats {
  events: number;
  steps: number;
  toolCalls: number;
  guardrailBlocks: number;
  guardrailSanitizations: number;
  compactions: number;
  warnings: number;
  toolsUsed: Record<string, number>;
  pathsTouched: string[];
}


// Receipt Builder   




 export class ReceiptBuilder {
  private entriesList: ReceiptEntry[] = [];
  private startedAt: string | null = null;
  private endedAt: string | null = null;
  private model = "unknown";
  private input = "";
  private runId = "";
  private readonly sessionId: string;
  private steps = 0;
  private toolCalls = 0;
  private blocks = 0;
  //Sanitization means cleaning or modifying data so that it is safer or acceptable before allowing it to continue.
  private sanitizations = 0;
  private compactions = 0;
  private warnings = 0;
  private readonly toolsUsed = new Map<string, number>();
  private readonly paths = new Set<string>();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }







  

  append(event: AgentEvent): ReceiptEntry {
    this.observe(event);

    const entry: ReceiptEntry = {
      seq: event.seq,
      at: event.at,
      type: event.type,
      summary: summarise(event),
      details: extractDetails(event),
    };

    this.entriesList.push(entry);
    return entry;
  }

  private observe(event: AgentEvent): void {
    switch (event.type) {
      case "run_start":
        this.startedAt = event.at;
        this.model = event.model;
        this.input = event.input;
        this.runId = event.runId;
        break;
      case "step_start":
        this.steps = Math.max(this.steps, event.step);
        break;
      case "tool_call": {
        this.toolCalls += 1;
        this.toolsUsed.set(event.call.name, (this.toolsUsed.get(event.call.name) ?? 0) + 1);
        for (const key of ["path", "file", "dir", "target", "dest"]) {
          const v = event.call.args[key];
          if (typeof v === "string" && v.length > 0) this.paths.add(v);
        }
        break;
      }
      case "guardrail":
        if (event.action === "block") this.blocks += 1;
        else this.sanitizations += 1;
        break;
      case "compaction":
        this.compactions += 1;
        break;
      case "notice":
        if (event.level === "warn") this.warnings += 1;
        break;
      case "run_end":
        this.endedAt = event.at;
        break;
      default:
        break;
    }
  }

  /** Number of entries recorded so far. */
  get length(): number {
    return this.entriesList.length;
  }

  /** Returns copy of all entries recorded so far. */
  get entries(): ReceiptEntry[] {
    return [...this.entriesList];
  }

  /** Finalise the receipt upon run completion. */
  finalise(outcome: RunOutcome, egress?: EgressAttestation): TrustReceipt {
    const receipt: TrustReceipt = {
     
      runId: this.runId || outcome.runId,
      sessionId: this.sessionId,
      model: this.model,
      startedAt: this.startedAt ?? new Date(0).toISOString(),
      endedAt: this.endedAt ?? new Date().toISOString(),
      input: this.input,
      outcome,
      stats: {
        events: this.entriesList.length,
        steps: this.steps,
        toolCalls: this.toolCalls,
        guardrailBlocks: this.blocks,
        guardrailSanitizations: this.sanitizations,
        compactions: this.compactions,
        warnings: this.warnings,
        toolsUsed: Object.fromEntries([...this.toolsUsed.entries()].sort()),
        pathsTouched: [...this.paths].sort(),
      },
      entries: this.entriesList,
    };

    if (egress) receipt.egress = egress;
    return receipt;
  }
}

/* ------------------------------------------------------------------------- */
/* Verification / Validation (No Hashes)                                     */
/* ------------------------------------------------------------------------- */

export interface VerificationResult {
  valid: boolean;
  brokenAt?: number;
  reason?: string;
  entriesChecked: number;
}



export function verifyReceipt(receipt: TrustReceipt): VerificationResult {
  const entries = receipt.entries ?? [];
  let expectedSeq = 1;

  for (const [i, entry] of entries.entries()) {
    if (entry.seq !== expectedSeq) {
      return {
        valid: false,
        brokenAt: i,
        reason: `sequence gap: expected ${expectedSeq}, found ${entry.seq}`,
        entriesChecked: i,
      };
    }
    expectedSeq += 1;
  }

  return { valid: true, entriesChecked: entries.length };
}






export function receiptToMarkdown(
  receipt: TrustReceipt,
  opts: { includeEntries?: boolean } = {},
): string {
  const lines: string[] = [];
  const entries = receipt.entries ?? [];

  lines.push("# Audit Receipt");
  lines.push("");
  lines.push(`Run \`${receipt.runId}\` · session \`${receipt.sessionId}\``);
  lines.push("");
  lines.push(`- Model: \`${receipt.model}\``);
  lines.push(`- Started: ${receipt.startedAt}`);
  lines.push(`- Ended: ${receipt.endedAt} (${receipt.outcome.durationMs} ms)`);
  lines.push(`- Result: **${receipt.outcome.stopReason}** after ${receipt.stats.steps} step(s)`);
  lines.push(
    `- Tokens: ${receipt.outcome.usage.totalTokens} total ` +
      `(${receipt.outcome.usage.promptTokens} prompt, ${receipt.outcome.usage.completionTokens} completion)`,
  );
  lines.push(`- Total Events: ${entries.length}`);
  lines.push("");

  lines.push("## Request");
  lines.push("");
  lines.push("> " + receipt.input.replace(/\n/g, "\n> "));
  lines.push("");

  lines.push("## Actions Taken");
  lines.push("");
  if (receipt.stats.toolCalls === 0) {
    lines.push("No tools were invoked; this run was answered from the model's knowledge.");
  } else {
    const tools = Object.entries(receipt.stats.toolsUsed)
      .map(([n, c]) => `${n} ×${c}`)
      .join(", ");
    lines.push(`${receipt.stats.toolCalls} tool call(s): ${tools}.`);
    if (receipt.stats.pathsTouched.length > 0) {
      lines.push("");
      lines.push(`Paths referenced: ${receipt.stats.pathsTouched.map((p) => `\`${p}\``).join(", ")}.`);
    }
  }
  lines.push("");

  lines.push("## Policy Enforcement");
  lines.push("");
  lines.push(
    `${receipt.stats.guardrailBlocks} block(s), ${receipt.stats.guardrailSanitizations} sanitisation(s), ` +
      `${receipt.stats.warnings} warning(s), ${receipt.stats.compactions} context compaction(s).`,
  );

  if (receipt.egress) {
    const eg = receipt.egress;
    lines.push("");
    lines.push(
      `Network egress: guard ${eg.enforced ? "ENFORCED" : "NOT ENFORCED"}. ` +
        `${eg.totalRequests} outbound request(s) observed, ${eg.allowedRequests} permitted, ` +
        `${eg.blockedRequests} refused. ` +
        `Allowlist: ${eg.allowlist.length > 0 ? eg.allowlist.join(", ") : "(empty — all egress refused)"}.`,
    );
    if (eg.violations.length > 0) {
      lines.push("");
      lines.push("Refused attempts:");
      lines.push("");
      for (const v of eg.violations.slice(0, 20)) {
        lines.push(`- \`${v.host}\` at ${v.at} — ${v.reason}`);
      }
    }
  }
  lines.push("");

  if (opts.includeEntries ?? true) {
    lines.push("## Event Log");
    lines.push("");
    lines.push("| # | Time | Event | Summary |");
    lines.push("| - | ---- | ----- | ------- |");
    for (const e of entries) {
      lines.push(`| ${e.seq} | ${e.at.slice(11, 23)} | ${e.type} | ${escapeCell(e.summary)} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function escapeCell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 160);
}

/** JSONL format for appending runs to an audit log file. */
export function receiptToJsonl(receipt: TrustReceipt): string {
  const entries = receipt.entries ?? [];
  return entries.map((e) => JSON.stringify({ runId: receipt.runId, ...e })).join("\n") + "\n";
}






//help in sumarization
export function summarise(e: AgentEvent): string {
  switch (e.type) {
    case "run_start":
      return `run started on ${e.model}`;
    case "step_start":
      return `step ${e.step}`;
    case "text_delta":
      return `${e.text.length} chars streamed`;
    case "assistant_message":
      return `assistant replied (${e.finishReason}, ${e.text.length} chars)`;
    case "tool_call":
      return `call ${e.call.name} args=${truncate(JSON.stringify(e.call.args), 120)}`;
    case "tool_result":
      return `${e.call.name} → ${e.result.ok ? "ok" : "error"} (${e.durationMs}ms${
        e.result.guardrailAction && e.result.guardrailAction !== "allow"
          ? `, ${e.result.guardrailAction}`
          : ""
      })`;
    case "guardrail":
      return `${e.guard} ${e.action} @${e.stage}: ${truncate(e.reason, 120)}`;
    case "compaction":
      return `compacted ${e.droppedMessages} msgs ${e.tokensBefore}→${e.tokensAfter} tok (${e.method})`;
    case "notice":
      return `[${e.level}] ${truncate(e.message, 140)}`;
    case "run_end":
      return `run ended: ${e.outcome.stopReason}`;
  }
}









//
function extractDetails(e: AgentEvent): Record<string, unknown> | undefined {
  switch (e.type) {
    case "tool_call":
      return { tool: e.call.name, args: e.call.args };
    case "tool_result":
      return { tool: e.call.name, ok: e.result.ok, durationMs: e.durationMs };
    case "guardrail":
      return { guard: e.guard, stage: e.stage, action: e.action, reason: e.reason };
    case "notice":
      return { level: e.level, message: e.message, detail: e.detail };
    default:
      return undefined;
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
