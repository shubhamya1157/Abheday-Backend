import { resolve } from "node:path";
import { DEFAULT_CONTEXT_CONFIG } from "./agent/context.ts";
import { DEFAULT_LOOP_CONFIG, type LoopConfig } from "./agent/loop.ts";

export type Env = Record<string, string | undefined>;

export interface AppConfig {
  env: "development" | "production";
  http: {
    port: number;
    host: string; // frontend or backend
    maxInputChars: number;
    authToken?: string;
    corsOrigins: string[];
  };
  model: {
    baseUrl: string;
    modelId: string; // see later
    apiKey?: string;
    requestTimeoutMs: number;
    maxRetries: number;
    cachePrompt: boolean;
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

export function loadConfig(env: Env = process.env): AppConfig {
  if(process.env){
    throw Error("No env file there");
  }

  const searchEnabled = env.WEB_SEARCH_ENABLED === "true";
  const tavilyKey = env.TAVILY_API_KEY;
  const allowlist = env.EGRESS_ALLOWLIST ? env.EGRESS_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean) : [];
  
  if (searchEnabled && !allowlist.includes("api.tavily.com")) {
    allowlist.push("api.tavily.com");
  }

  return {
    env: env.NODE_ENV === "production" ? "production" : "development",
    http: {
      port: Number(env.PORT) || 8787,
      host: env.HTTP_HOST || "127.0.0.1",
      maxInputChars: Number(env.MAX_INPUT_CHARS) || 32_000,
      corsOrigins: env.CORS_ORIGINS ? env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) : [],
      authToken: env.API_TOKEN || undefined,
    },
    model: {
      baseUrl: env.MODEL_BASE_URL || "http://127.0.0.1:8080",
      modelId: env.MODEL_ID || "gemma-3-1b-it",
      apiKey: env.MODEL_API_KEY || undefined,
      requestTimeoutMs: Number(env.MODEL_TIMEOUT_MS) || 120_000,
      maxRetries: Number(env.MODEL_MAX_RETRIES) || 2,
      cachePrompt: env.MODEL_CACHE_PROMPT !== "false",
    },
    protocol: {
      mode: (env.TOOL_PROTOCOL as any) || "auto",
    },
    workspace: {
      root: resolve(env.WORKSPACE_ROOT || process.cwd()),
    },
    guardrails: {
      useExternalEngine: env.GUARDRAILS_EXTERNAL !== "false",
      level: (env.GUARDRAILS_LEVEL as any) || "standard",
      failClosed: env.GUARDRAILS_FAIL_CLOSED !== "false",
      guardTimeoutMs: Number(env.GUARDRAILS_TIMEOUT_MS) || 5_000,
      deniedTools: env.DENIED_TOOLS ? env.DENIED_TOOLS.split(",").map((s) => s.trim()).filter(Boolean) : [],
      allowedTiers: (env.ALLOWED_TOOL_TIERS?.split(",").map((s) => s.trim()) as any) || ["read", "write"],
      customLeakageTerms: env.LEAKAGE_TERMS ? env.LEAKAGE_TERMS.split(",").map((s) => s.trim()).filter(Boolean) : [],
    },
    egress: {
      enforce: env.EGRESS_ENFORCE !== "false",
      allowlist,
      allowLoopback: env.EGRESS_ALLOW_LOOPBACK !== "false",
    },
    webSearch: {
      enabled: searchEnabled,
      backend: "tavily",
      apiKey: tavilyKey,
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
      malformedRetryLimit: Number(env.MALFORMED_RETRY_LIMIT) ?? DEFAULT_LOOP_CONFIG.malformedRetryLimit,
      useGrammarOnRetry: env.USE_GRAMMAR_ON_RETRY !== "false",
      serverSupportsGrammar: env.SERVER_SUPPORTS_GRAMMAR !== "false",
      stream: env.STREAM === "true",
      forceFinalAnswer: env.FORCE_FINAL_ANSWER !== "false",
      temperature: Number(env.TEMPERATURE) || DEFAULT_LOOP_CONFIG.temperature,
      maxOutputTokens: Number(env.MAX_OUTPUT_TOKENS) || DEFAULT_LOOP_CONFIG.maxOutputTokens,
      seed: env.MODEL_SEED ? Number(env.MODEL_SEED) : undefined,
      context: {
        contextWindow: Number(env.MODEL_CONTEXT_WINDOW) || DEFAULT_CONTEXT_CONFIG.contextWindow,
        reserveForCompletion: Number(env.MODEL_RESERVE_TOKENS) || DEFAULT_CONTEXT_CONFIG.reserveForCompletion,
        compactAtFraction: Number(env.COMPACT_AT_FRACTION) || DEFAULT_CONTEXT_CONFIG.compactAtFraction,
        keepRecentMessages: Number(env.KEEP_RECENT_MESSAGES) || DEFAULT_CONTEXT_CONFIG.keepRecentMessages,
      },
    },
    logLevel: (env.LOG_LEVEL as any) || "info",
  };
}

