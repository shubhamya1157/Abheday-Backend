// The multi-model registry.
//
// The workbench does not run one model. It runs several local llama.cpp servers
// at once — a planner, a coding model, a vision/OCR model — each on its own
// local port (e.g. http://127.0.0.1:8080, :8081, :8082). This file turns the
// ModelDescriptor[] from config into a live LlamaCppProvider per model, keyed by
// model id, so the orchestrator can hand the agent loop whichever one it picked.
//
// One provider per DISTINCT endpoint is reused, so two descriptors that point at
// the same server share a single client (and its prompt cache).

import type { AppConfig } from "../../config/index.ts";
import type { ModelProvider } from "../../core/types.ts";
import type { ModelDescriptor } from "../orchestrator/types.ts";
import { LlamaCppProvider } from "./llama-provider.ts";

export interface RegisteredModel {
  descriptor: ModelDescriptor;
  provider: ModelProvider;
}

export interface ModelRegistryLog {
  (level: "debug" | "info" | "warn" | "error", msg: string, extra?: Record<string, unknown>): void;
}

/**
 * Holds one provider per model. Built once at boot from config.models. The
 * default/planner model is always present and is the fallback the router uses
 * when routing is off or no candidate matches.
 */
export class ModelRegistry {
  readonly #byId = new Map<string, RegisteredModel>();
  // Reuse one provider per endpoint so the same server is not opened twice.
  readonly #byEndpoint = new Map<string, ModelProvider>();
  readonly #defaultId: string;

  constructor(config: AppConfig, log: ModelRegistryLog = () => {}) {
    this.#defaultId = config.routing.defaultModelId;

    for (const descriptor of config.models) {
      if (!descriptor.enabled) continue;
      const provider = this.#providerFor(descriptor, config, log);
      this.#byId.set(descriptor.id, { descriptor, provider });
      log("info", "model registered", {
        id: descriptor.id,
        role: descriptor.role,
        endpoint: descriptor.endpoint,
      });
    }

    if (this.#byId.size === 0) {
      throw new Error("Model registry is empty — at least one enabled model is required.");
    }
    // Guarantee the default id resolves to something, even if config drifted.
    if (!this.#byId.has(this.#defaultId)) {
      const first = [...this.#byId.keys()][0]!;
      log("warn", "default model id not in registry, falling back to first model", {
        wanted: this.#defaultId,
        using: first,
      });
      this.#defaultId = first;
    }
  }

  /** Build (or reuse) the HTTP client for one model. */
  #providerFor(
    descriptor: ModelDescriptor,
    config: AppConfig,
    log: ModelRegistryLog,
  ): ModelProvider {
    const existing = this.#byEndpoint.get(descriptor.endpoint);
    if (existing) return existing;

    const provider = new LlamaCppProvider({
      baseUrl: descriptor.endpoint,
      model: descriptor.id,
      requestTimeoutMs: config.model.requestTimeoutMs,
      maxRetries: config.model.maxRetries,
      cachePrompt: config.model.cachePrompt,
      defaultTemperature: config.loop.temperature,
      defaultMaxTokens: config.loop.maxOutputTokens,
      ...(config.model.apiKey ? { apiKey: config.model.apiKey } : {}),
      onRequestLog: (info) => log("debug", "model request", { model: descriptor.id, ...info }),
    });

    this.#byEndpoint.set(descriptor.endpoint, provider);
    return provider;
  }

  /** The planner/default model — fallback for routing and the summariser. */
  get defaultModel(): RegisteredModel {
    return this.#byId.get(this.#defaultId)!;
  }

  get defaultId(): string {
    return this.#defaultId;
  }

  /** Look one up by id. Returns the default when the id is unknown. */
  get(id: string): RegisteredModel {
    return this.#byId.get(id) ?? this.defaultModel;
  }

  has(id: string): boolean {
    return this.#byId.has(id);
  }

  /** Every descriptor, for the router to score against. */
  descriptors(): ModelDescriptor[] {
    return [...this.#byId.values()].map((m) => m.descriptor);
  }

  /** Distinct providers, for boot-time health probing. */
  providers(): ModelProvider[] {
    return [...this.#byEndpoint.values()];
  }

  list(): RegisteredModel[] {
    return [...this.#byId.values()];
  }
}
