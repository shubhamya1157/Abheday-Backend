// Central configuration for the OPX sovereign workbench.
//
// Everything is read from environment variables (via a .env file loaded by
// `node --env-file=.env`). Every value has a safe default, and the defaults ARE
// the sovereign posture: loopback only, egress enforced, guardrails fail-closed,
// no network tool.
//
// This file also builds the MULTI-MODEL registry. Instead of one hard-coded
// model, the workbench can serve several local models at once (a planner, a
// coding model, a vision/OCR model, an embedding model) and route each task to
// the right one. Adding a new model later is a config change, not a code change.

import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { DEFAULT_CONTEXT_CONFIG } from "../services/memory/context.ts";
import { DEFAULT_LOOP_CONFIG, type LoopConfig } from "../services/agent/loop.ts";
import type { ModelDescriptor, ModelRole } from "../services/orchestrator/types.ts";

export type Env = Record<string, string | undefined>;

export interface AppConfig {
  env: "development" | "production";
  http: {
    port: number;
    host: string;
    maxInputChars: number;
    authToken?: string;
    corsOrigins: string[];
  };
  /** The default / planner model. Used as the fallback and for summarisation. */
  model: {
    baseUrl: string;
    modelId: string;
    apiKey?: string;
    requestTimeoutMs: number;
    maxRetries: number;
    cachePrompt: boolean;
  };
  /** The full multi-model registry. Always contains at least the default model. */
  models: ModelDescriptor[];
  routing: {
    /** When true, classify each task and route to the best model. */
    enabled: boolean;
    /** Model id used when routing is off or no candidate matches. */
    defaultModelId: string;
  };
  /** Local embedding model, for the semantic memory layer. */
  embedding: {
    enabled: boolean;
    baseUrl: string;
    modelId: string;
    apiKey?: string;
    timeoutMs: number;
  };
  /** Semantic memory layer. */
  memory: {
    enabled: boolean;
    /** Where the memory store JSON lives. */
    dir: string;
    /** How many memories to retrieve and inject before a run. */
    topK: number;
    /** Minimum cosine similarity for a memory to be considered relevant. */
    minScore: number;
  };
  protocol: {
    mode: "native" | "prompted" | "auto";
  };
  workspace: {
    root: string;
  };
  guardrails: {
    useExternalEngine: boolean;
    level: "relaxed" | "standard" | "strict";
    failClosed: boolean;
    guardTimeoutMs: number;
    deniedTools: string[];
    allowedTiers: Array<"read" | "write" | "execute">;
    customLeakageTerms: string[];
  };
  egress: {
    enforce: boolean;
    allowlist: string[];
    allowLoopback: boolean;
  };
  webSearch: {
    enabled: boolean;
    backend: "tavily";
    apiKey?: string;
    maxResults: number;
    timeoutMs: number;
  };
  audit: {
    dir: string;
    writeMarkdown: boolean;
  };
  loop: LoopConfig;
  logLevel: "trace" | "debug" | "info" | "warn" | "error";
}

/* -------------------------------------------------------------------------- */
/* Model registry loading                                                     */
/* -------------------------------------------------------------------------- */

/** Sensible capability defaults per role, so a short config entry still works. */
const ROLE_DEFAULTS: Record<ModelRole, ModelDescriptor["capabilities"]> = {
  general: { reasoning: 2, coding: 1, vision: 0, document: 1, toolCalling: true },
  reasoning: { reasoning: 3, coding: 1, vision: 0, document: 2, toolCalling: true },
  coding: { reasoning: 2, coding: 3, vision: 0, document: 1, toolCalling: true },
  vision: { reasoning: 2, coding: 0, vision: 3, document: 2, toolCalling: false },
  document: { reasoning: 2, coding: 0, vision: 1, document: 3, toolCalling: true },
  multimodal: { reasoning: 3, coding: 1, vision: 3, document: 3, toolCalling: true },
};

/** A relaxed shape the user can write in MODELS_JSON — most fields optional. */
interface ModelConfigInput {
  id: string;
  role?: ModelRole;
  endpoint: string;
  modelId?: string;
  capabilities?: Partial<ModelDescriptor["capabilities"]>;
  contextWindow?: number;
  inputModalities?: ModelDescriptor["inputModalities"];
  outputModalities?: ModelDescriptor["outputModalities"];
  toolCalling?: boolean;
  priority?: number;
  enabled?: boolean;
  resourceRequirements?: ModelDescriptor["resourceRequirements"];
}

/** Turn a relaxed config entry into a complete ModelDescriptor. */
function normaliseDescriptor(input: ModelConfigInput): ModelDescriptor {
  const role: ModelRole = input.role ?? "general";
  const caps = { ...ROLE_DEFAULTS[role], ...(input.capabilities ?? {}) };
  const toolCalling = input.toolCalling ?? caps.toolCalling;

  // Reasonable modality defaults from the role.
  const inputModalities =
    input.inputModalities ??
    (role === "vision" || role === "multimodal"
      ? (["text", "image", "pdf", "document"] as const).slice()
      : (["text"] as const).slice());
  const outputModalities =
    input.outputModalities ??
    (role === "coding"
      ? (["text", "code"] as const).slice()
      : role === "document"
        ? (["text", "document", "spreadsheet", "presentation"] as const).slice()
        : (["text", "code", "document"] as const).slice());

  const descriptor: ModelDescriptor = {
    id: input.id,
    role,
    capabilities: caps,
    contextWindow: input.contextWindow ?? 8192,
    inputModalities,
    outputModalities,
    toolCalling,
    endpoint: input.endpoint,
    runtime: "llama.cpp",
    enabled: input.enabled ?? true,
    // The concrete model id the server routes on (LM Studio / vLLM need it).
    modelId: input.modelId ?? input.id,
    priority: input.priority ?? 0,
  };
  if (input.resourceRequirements) descriptor.resourceRequirements = input.resourceRequirements;
  return descriptor;
}

/**
 * Build the model registry. Priority order:
 *   1. MODELS_JSON — an inline JSON array/object of models.
 *   2. MODELS_CONFIG_PATH — a path to a JSON file with the same shape.
 *   3. Fall back to a single "general" model built from the default MODEL_* vars.
 * The fallback guarantees the router always has at least one candidate.
 */
function loadModelRegistry(env: Env, fallback: AppConfig["model"]): ModelDescriptor[] {
  const raw = readRegistrySource(env);

  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const list: unknown = Array.isArray(parsed)
        ? parsed
        : (parsed as { models?: unknown }).models;
      if (Array.isArray(list) && list.length > 0) {
        return list.map((entry) => normaliseDescriptor(entry as ModelConfigInput));
      }
    } catch (err) {
      // Do not crash boot on a bad registry — fall back and warn via console.
      console.warn(
        `[config] Could not parse the model registry, using the default model only: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // Fallback: one general-purpose planner model from MODEL_* vars.
  return [
    normaliseDescriptor({
      id: fallback.modelId,
      role: "general",
      endpoint: fallback.baseUrl,
      modelId: fallback.modelId,
      priority: 0,
    }),
  ];
}

function readRegistrySource(env: Env): string | null {
  if (env.MODELS_JSON && env.MODELS_JSON.trim().length > 0) return env.MODELS_JSON;
  if (env.MODELS_CONFIG_PATH && env.MODELS_CONFIG_PATH.trim().length > 0) {
    try {
      return readFileSync(resolve(env.MODELS_CONFIG_PATH), "utf8");
    } catch (err) {
      console.warn(
        `[config] MODELS_CONFIG_PATH could not be read: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Config loading                                                             */
/* -------------------------------------------------------------------------- */

export function loadConfig(env: Env = process.env): AppConfig {
  const searchEnabled = env.WEB_SEARCH_ENABLED === "true";
  const tavilyKey = env.TAVILY_API_KEY;

  const allowlist = env.EGRESS_ALLOWLIST
    ? env.EGRESS_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (searchEnabled && !allowlist.includes("api.tavily.com")) {
    allowlist.push("api.tavily.com");
  }

  const model: AppConfig["model"] = {
    baseUrl: env.MODEL_BASE_URL || "http://127.0.0.1:8080",
    modelId: env.MODEL_ID || "qwen2.5-coder-7b-instruct",
    apiKey: env.MODEL_API_KEY || undefined,
    requestTimeoutMs: Number(env.MODEL_TIMEOUT_MS) || 120_000,
    maxRetries: Number(env.MODEL_MAX_RETRIES) || 2,
    cachePrompt: env.MODEL_CACHE_PROMPT !== "false",
  };

  const models = loadModelRegistry(env, model);
  const host = env.HTTP_HOST || "127.0.0.1";
  const authToken = env.API_TOKEN || undefined;

  // Security: a network-exposed host with no token is an unauthenticated remote
  // shell, because the agent can write files. Refuse to start in that state.
  const isLoopbackHost = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (!isLoopbackHost && !authToken) {
    throw new Error(
      `HTTP_HOST is "${host}" (network-exposed) but API_TOKEN is not set. ` +
        `An unauthenticated agent that can write files is a remote shell. ` +
        `Set API_TOKEN, or bind to 127.0.0.1.`,
    );
  }

  return {
    env: env.NODE_ENV === "production" ? "production" : "development",
    http: {
      port: Number(env.PORT) || 8787,
      host,
      maxInputChars: Number(env.MAX_INPUT_CHARS) || 32_000,
      corsOrigins: env.CORS_ORIGINS
        ? env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      ...(authToken ? { authToken } : {}),
    },
    model,
    models,
    routing: {
      enabled: env.ROUTING_ENABLED !== "false",
      defaultModelId: env.ROUTING_DEFAULT_MODEL || model.modelId,
    },
    embedding: {
      enabled: env.EMBEDDING_ENABLED !== "false",
      baseUrl: env.EMBEDDING_BASE_URL || "http://127.0.0.1:8090",
      modelId: env.EMBEDDING_MODEL_ID || "nomic-embed-text",
      apiKey: env.EMBEDDING_API_KEY || undefined,
      timeoutMs: Number(env.EMBEDDING_TIMEOUT_MS) || 30_000,
    },
    memory: {
      enabled: env.MEMORY_ENABLED !== "false",
      dir: env.MEMORY_DIR || "./memory-store",
      topK: Number(env.MEMORY_TOP_K) || 5,
      minScore: Number(env.MEMORY_MIN_SCORE) || 0.35,
    },
    protocol: {
      mode: (env.TOOL_PROTOCOL as AppConfig["protocol"]["mode"]) || "auto",
    },
    workspace: {
      root: resolve(env.WORKSPACE_ROOT || process.cwd()),
    },
    guardrails: {
      useExternalEngine: env.GUARDRAILS_EXTERNAL !== "false",
      level: (env.GUARDRAILS_LEVEL as AppConfig["guardrails"]["level"]) || "standard",
      failClosed: env.GUARDRAILS_FAIL_CLOSED !== "false",
      guardTimeoutMs: Number(env.GUARDRAILS_TIMEOUT_MS) || 5_000,
      deniedTools: env.DENIED_TOOLS
        ? env.DENIED_TOOLS.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
      allowedTiers:
        (env.ALLOWED_TOOL_TIERS?.split(",").map((s) => s.trim()) as AppConfig["guardrails"]["allowedTiers"]) ||
        ["read", "write"],
      customLeakageTerms: env.LEAKAGE_TERMS
        ? env.LEAKAGE_TERMS.split(",").map((s) => s.trim()).filter(Boolean)
        : [],
    },
    egress: {
      enforce: env.EGRESS_ENFORCE !== "false",
      allowlist,
      allowLoopback: env.EGRESS_ALLOW_LOOPBACK !== "false",
    },
    webSearch: {
      enabled: searchEnabled,
      backend: "tavily",
      ...(tavilyKey ? { apiKey: tavilyKey } : {}),
      maxResults: Number(env.WEB_SEARCH_MAX_RESULTS) || 5,
      timeoutMs: Number(env.WEB_SEARCH_TIMEOUT_MS) || 15_000,
    },
    audit: {
      dir: env.AUDIT_DIR || "",
      writeMarkdown: env.AUDIT_MARKDOWN !== "false",
    },
    loop: {
      ...DEFAULT_LOOP_CONFIG,
      maxSteps: Number(env.MAX_STEPS) || DEFAULT_LOOP_CONFIG.maxSteps,
      repeatCallLimit: Number(env.REPEAT_CALL_LIMIT) || DEFAULT_LOOP_CONFIG.repeatCallLimit,
      malformedRetryLimit:
        Number(env.MALFORMED_RETRY_LIMIT) ?? DEFAULT_LOOP_CONFIG.malformedRetryLimit,
      useGrammarOnRetry: env.USE_GRAMMAR_ON_RETRY !== "false",
      serverSupportsGrammar: env.SERVER_SUPPORTS_GRAMMAR !== "false",
      stream: env.STREAM === "true",
      forceFinalAnswer: env.FORCE_FINAL_ANSWER !== "false",
      temperature: Number(env.TEMPERATURE) || DEFAULT_LOOP_CONFIG.temperature,
      maxOutputTokens: Number(env.MAX_OUTPUT_TOKENS) || DEFAULT_LOOP_CONFIG.maxOutputTokens,
      ...(env.MODEL_SEED ? { seed: Number(env.MODEL_SEED) } : {}),
      context: {
        contextWindow: Number(env.MODEL_CONTEXT_WINDOW) || DEFAULT_CONTEXT_CONFIG.contextWindow,
        reserveForCompletion:
          Number(env.MODEL_RESERVE_TOKENS) || DEFAULT_CONTEXT_CONFIG.reserveForCompletion,
        compactAtFraction:
          Number(env.COMPACT_AT_FRACTION) || DEFAULT_CONTEXT_CONFIG.compactAtFraction,
        keepRecentMessages:
          Number(env.KEEP_RECENT_MESSAGES) || DEFAULT_CONTEXT_CONFIG.keepRecentMessages,
      },
    },
    logLevel: (env.LOG_LEVEL as AppConfig["logLevel"]) || "info",
  };
}
