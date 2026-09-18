//The LLM has limited space. When the conversation becomes too large, this file decides how big it is, when to compact it,
//  what to keep, what to summarize, and how to safely remove old messages.

import type { Message } from "../../core/types.ts";
import { countTokens } from "gpt-tokenizer";

//String token calculation
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return countTokens(text);
}


// to remove because all the things will be provided by the LLM...
// to evaluate how to handle if ctrl+c in between 
export function estimateMessageTokens(m: Message): number {
  let n = estimateTokens(m.content);
   n += 7;
  for (const tc of m.toolCalls ?? []) {
    n += estimateTokens(tc.name) + estimateTokens(JSON.stringify(tc.args)) + 11;
  }
  return n;
}


//Complete conversation token counting
export function estimateConversationTokens(messages: readonly Message[]): number {
  // sum of all message token....
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}


export interface ContextConfig {
    contextWindow: number;  
    reserveForCompletion: number;
    compactAtFraction: number;
    keepRecentMessages: number;
}

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  contextWindow: 8192,// for our model
  reserveForCompletion: 1024,
  compactAtFraction: 0.75,
  keepRecentMessages: 6,//6 recent message completely
};


export function promptBudget(cfg: ContextConfig): number {
  return Math.max(512, cfg.contextWindow - cfg.reserveForCompletion);
}


// telling is coversation is becoming too large or not it give true or false 
export function needsCompaction(messages: readonly Message[], cfg: ContextConfig): boolean {
  return estimateConversationTokens(messages) > promptBudget(cfg) * cfg.compactAtFraction;
}





export function isUnsafeCutPoint(messages: readonly Message[], index: number): boolean {
  const m = messages[index];
  if (!m) return false;
  return m.role === "tool";
}

export function selectTail(messages: readonly Message[], keepRecent: number): number {
  let start = Math.max(0, messages.length - keepRecent);

  
  while (start > 0 && isUnsafeCutPoint(messages, start)) start--;


  const prev = messages[start - 1];
  if (prev && prev.role === "assistant" && (prev.toolCalls?.length ?? 0) > 0) {
    start -= 1;
  }

  return start;
}

export interface CompactionPlan {
  /** Messages kept verbatim at the front (system, pinned). */
  head: Message[];
  /** Messages to be replaced by a summary. */
  middle: Message[];
  /** Messages kept verbatim at the end. */
  tail: Message[];
}


export function planCompaction(messages: readonly Message[], cfg: ContextConfig): CompactionPlan {
  const head: Message[] = [];
  let cursor = 0;

  while (cursor < messages.length) {
    const m = messages[cursor];
    if (!m) break;
    if (m.role === "system" || m.meta?.pinned === true) {
      head.push(m);
      cursor++;
      continue;
    }
    break;
  }

  // Pin the first user message (the task) if it was not already captured.
  const firstUserIdx = messages.findIndex((m) => m.role === "user");
  if (firstUserIdx >= cursor && firstUserIdx !== -1) {
    const m = messages[firstUserIdx];
    if (m) head.push({ ...m, meta: { ...(m.meta ?? {}), pinned: true } });
  }

  const tailStart = Math.max(cursor, selectTail(messages, cfg.keepRecentMessages));
  const middle = messages
    .slice(cursor, tailStart)
    .filter((_m, i) => cursor + i !== firstUserIdx);
  const tail = messages.slice(tailStart);

  return { head, middle, tail };
}

/**
 * Render dropped messages into a compact transcript for the summariser.
 * Tool results are aggressively clipped — their bulk is exactly what we are
 * trying to reclaim, and their gist is usually one line.
 */
export function renderForSummary(messages: readonly Message[]): string {
  return messages
    .map((m) => {
      if (m.role === "assistant") {
        const calls = (m.toolCalls ?? [])
          .map((tc) => `called ${tc.name}(${JSON.stringify(tc.args).slice(0, 160)})`)
          .join("; ");
        const text = m.content.trim().slice(0, 400);
        return `ASSISTANT: ${[text, calls].filter(Boolean).join(" | ")}`;
      }
      if (m.role === "tool") {
        return `TOOL(${m.name ?? "?"}): ${m.content.trim().slice(0, 300)}`;
      }
      return `${m.role.toUpperCase()}: ${m.content.trim().slice(0, 400)}`;
    })
    .join("\n");
}

/** Prompt used to summarise dropped history. */
export function summarisationPrompt(transcript: string): string {
  return [
    "Summarise the following agent transcript so work can continue without it.",
    "",
    "Preserve, as compactly as possible:",
    "- what the operator asked for",
    "- files inspected or modified, with their paths",
    "- concrete findings, values, and decisions already made",
    "- what has been tried and failed, so it is not repeated",
    "",
    "Omit pleasantries and reasoning narration. Write dense factual notes, not prose.",
    "Do not invent anything that is not in the transcript.",
    "",
    "TRANSCRIPT:",
    transcript,
  ].join("\n");
}

/** Wrap a summary as a synthetic message for reinsertion. */
export function summaryMessage(summary: string): Message {
  return {
    role: "user",
    content:
      "[CONTEXT SUMMARY — earlier turns were compacted to save space]\n" +
      summary.trim() +
      "\n[END SUMMARY]",
    meta: { synthetic: true, pinned: true },
  };
}

/**
 * Fallback used when the summariser itself is unavailable or fails.
 * Losing history silently is unacceptable, so we record the shape of what went.
 */
export function mechanicalSummary(messages: readonly Message[]): string {
  const toolCalls = new Map<string, number>();
  const paths = new Set<string>();

  for (const m of messages) {
    for (const tc of m.toolCalls ?? []) {
      toolCalls.set(tc.name, (toolCalls.get(tc.name) ?? 0) + 1);
      const p = tc.args["path"];
      if (typeof p === "string") paths.add(p);
    }
  }

  const lines = [`${messages.length} earlier messages were dropped without summarisation.`];
  if (toolCalls.size > 0) {
    lines.push(
      `Tools used: ${[...toolCalls.entries()].map(([n, c]) => `${n}×${c}`).join(", ")}.`,
    );
  }
  if (paths.size > 0) {
    lines.push(`Paths touched: ${[...paths].slice(0, 20).join(", ")}.`);
  }
  lines.push("Re-read any file you need to be certain about.");
  return lines.join(" ");
}
