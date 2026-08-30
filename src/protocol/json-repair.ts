// We do NOT send the broken JSON back. We send the REPAIRED JSON back!

import { jsonrepair } from "jsonrepair";

export interface JsonParseOutcome {
  ok: boolean;
  value: unknown;
  /** True when we had to repair the JSON. */
  repaired: boolean;
  /** Human-readable list of repairs applied, for the audit log. */
  repairs: string[];
  error?: string;
}

/**
 * Remove ```json ... ``` or ``` ... ``` markdown wrappers.
 * Generally small models give in this format.
 */
export function stripCodeFence(text: string): { text: string; stripped: boolean } {
  const t = text.trim();
  const m = /^```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)(?:\n?```)?\s*$/.exec(t);
  if (m && m[1] !== undefined && t.startsWith("```")) {
    return { text: m[1].trim(), stripped: true };
  }
  return { text: t, stripped: false };
}

/**
 * Extract the outermost balanced JSON object {...} or array [...] if surrounded by conversational text.
 */
export function extractBalanced(input: string): { text: string; start: number; complete: boolean } | null {
  const start = input.search(/[{\[]/);
  if (start === -1) return null;

  const openChar = input[start];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString: string | null = null;
  let escaped = false;

  for (let i = start; i < input.length; i++) {
    const ch = input[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
    } else if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return { text: input.slice(start, i + 1), start, complete: true };
      }
    }
  }

  return { text: input.slice(start), start, complete: false };
}

/**
 * Tolerant JSON parser using the `jsonrepair` library.
 * Automatically fixes single quotes, trailing commas, Python literals (True/False/None),
 * markdown code fences, conversational prose, and unquoted keys.
 */
export function parseJsonLoose(raw: string): JsonParseOutcome {
  const repairs: string[] = [];

  if (!raw || raw.trim().length === 0) {
    return { ok: false, value: undefined, repaired: false, repairs, error: "empty input" };
  }

  // 1. Fast path: Standard JSON.parse
  try {
    return { ok: true, value: JSON.parse(raw), repaired: false, repairs };
  } catch {
    /* escalate */
  }

  // 2. Strip code fences (```json ... ```)
  const fenced = stripCodeFence(raw);
  if (fenced.stripped) repairs.push("stripped markdown code fence");

  try {
    return { ok: true, value: JSON.parse(fenced.text), repaired: true, repairs };
  } catch {
    /* escalate */
  }

  // 3. Extract JSON from conversational text if present
  const balanced = extractBalanced(fenced.text);
  const targetText = balanced ? balanced.text : fenced.text;
  if (balanced && balanced.start > 0) repairs.push("discarded prose before JSON");

  // 4. Repair using jsonrepair library
  try {
    const repairedString = jsonrepair(targetText);
    const value = JSON.parse(repairedString);
    repairs.push("repaired with jsonrepair");
    return { ok: true, value, repaired: true, repairs };
  } catch (err) {
    return {
      ok: false,
      value: undefined,
      repaired: true,
      repairs,
      error: err instanceof Error ? err.message : "json repair failed",
    };
  }
}
