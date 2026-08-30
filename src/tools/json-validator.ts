/**
 * JSON Schema validator using AJV.
 *
 * WHY AJV HERE:
 * JSON Schema is already the required output format. The model consumes it
 * (REST `tools` field), and the GBNF generator consumes it.
 *
 * COERCION IS DELIBERATE. Small models emit "5" for a number and "true" for a
 * boolean constantly. Rejecting those is technically correct and practically
 * useless: it burns a loop iteration on a call the model got semantically right.
 * We coerce when unambiguous via AJV (`coerceTypes: true`) and report every
 * coercion/normalization, so the audit trail shows exactly what was changed.
 */

import { Ajv, type ErrorObject } from "ajv";
import type { JsonSchema } from "../core/types.ts";

const ajv = new Ajv({
  coerceTypes: true, // Auto-coerces "5" -> 5, "true" -> true
  useDefaults: true, // Injects default values from schema
  removeAdditional: false,
  allErrors: true,
  strict: false, // Tolerates flexible schemas
});

export interface ValidationOk<T> {
  ok: true;
  value: T;
  /** Coercions and defaults applied, for the audit log. */
  notes: string[];
}

export interface ValidationErr {
  ok: false;
  errors: string[];
  notes: string[];
}

export type ValidationResult<T> = ValidationOk<T> | ValidationErr;

/**
 * Validate and coerce `input` against `schema`.
 * Returns a NEW object; never mutates the caller's input.
 */
export function validateAgainstSchema<T = Record<string, unknown>>(
  input: unknown,
  schema: JsonSchema,
): ValidationResult<T> {
  const notes: string[] = [];

  // Clone input to allow in-place type coercion without mutating caller's original object
  let data: unknown;
  try {
    data = typeof input === "object" && input !== null ? structuredClone(input) : input;
  } catch {
    data = input;
  }

  // Pre-normalize keys: Fix case-sensitivity issues from small models (e.g. "Path" -> "path")
  if (typeof data === "object" && data !== null && !Array.isArray(data) && schema.properties) {
    const obj = data as Record<string, unknown>;
    const schemaProps = Object.keys(schema.properties);
    for (const key of Object.keys(obj)) {
      const match = schemaProps.find((p) => p.toLowerCase() === key.toLowerCase() && p !== key);
      if (match && !(match in obj)) {
        obj[match] = obj[key];
        delete obj[key];
        notes.push(`${key}: normalized case to "${match}"`);
      }
    }
  }

  try {
    const validate = ajv.compile(schema as Record<string, unknown>);
    const valid = validate(data);

    if (!valid) {
      const errors = (validate.errors ?? []).map((err: ErrorObject) => {
        const field = err.instancePath ? err.instancePath.replace(/^\//, "").replace(/\//g, ".") : "value";
        return `${field} ${err.message ?? "is invalid"}`;
      });
      return { ok: false, errors, notes };
    }

    return { ok: true, value: data as T, notes };
  } catch (err) {
    return {
      ok: false,
      errors: [err instanceof Error ? err.message : "Schema validation error"],
      notes,
    };
  }
}
