// The Harness — assembles every part of the workbench and drives a run.
//
// It owns the pieces that are built ONCE at boot (egress guard, model registry,
// guardrails, tools, system prompt) and, for each run, wires them into the
// stateless agent loop. Two things make this harness different from a single-
// model agent:
//
//   1. MULTI-MODEL ROUTING. Instead of one provider, it holds a ModelRegistry
//      (one llama.cpp client per local model). For each run it classifies the
//      task and routes to the best specialist, falling back to the planner.
//
//   2. SEMANTIC MEMORY. Before a run it retrieves relevant memories and injects
//      them into the conversation; after a run it records the outcome. Both are
//      best-effort and can never fail a run.
//
// The agent loop and the ModelProvider interface are UNCHANGED — routing just
// decides which provider instance gets handed to the loop.

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  DEFAULT_LOOP_CONFIG,
  runAgent,
  type LoopConfig,
  type LoopDeps,
  type RunRequest,
} from "./loop.ts";
import type { AgentEvent, RunOutcome } from "./events.ts";
import {
  ReceiptBuilder,
  receiptToJsonl,
  receiptToMarkdown,
  type TrustReceipt,
} from "../audit/receipt.ts";
import type { AppConfig } from "../../config/index.ts";
import { AgentError, type HealthInfo, type Message, type ModelProvider } from "../../core/types.ts";
import { injectionGuard, secretsGuard, toolSafetyGuards } from "../guardrails/builtin-guards.ts";
import { externalEngineGuards, loadExternalEngine, MRPL_LEAKAGE_TERMS } from "../guardrails/core-adapter.ts";
import { GuardrailPipeline } from "../guardrails/pipeline.ts";
import { EgressGuard } from "../security/egress-guard.ts";
import { LlamaCppProvider } from "../models/llama-provider.ts";
import { ModelRegistry } from "../models/model-registry.ts";
import { resolveModel, type RouteResult } from "../orchestrator/resolve.ts";
import { EmbeddingProvider } from "../memory/embedding.ts";
import { MemoryStore } from "../memory/store.ts";
import { MemoryManager } from "../memory/memory-manager.ts";
import { createMemorySearchTool } from "../memory/memory-tool.ts";
import { buildSystemPrompt } from "../../prompt/system-prompt.ts";
import { NativeToolProtocol } from "../../protocol/native.ts";
import { PromptedToolProtocol } from "../../protocol/prompted.ts";
import type { ToolProtocol } from "../../protocol/types.ts";
import { builtinFsTools } from "../../tools/builtin.ts";
import { ToolRegistry } from "../../tools/registry.ts";
import { createWebSearchTool, SEARCH_HOSTS } from "../../tools/web-search.ts";

export type Logger = (
  level: "debug" | "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>,
) => void;

export interface HarnessBootReport {
  /** The default/planner model id. */
  defaultModel: string;
  /** Every registered model and whether its server answered at boot. */
  models: Array<{ id: string; role: string; endpoint: string; reachable: boolean }>;
  routingEnabled: boolean;
  health: HealthInfo;
  protocolMode: "native" | "prompted";
  protocolReason: string;
  guardrails: { external: boolean; externalReason: string; guardCount: number };
  egressEnforced: boolean;
  memoryEnabled: boolean;
  /** True when the search tool is registered, i.e. the deployment is not air-gapped. */
  networkToolEnabled: boolean;
  tools: string[];
  systemPromptChars: number;
  warnings: string[];
}

export interface SessionResult {
  outcome: RunOutcome;
  receipt: TrustReceipt;
  /** Which model handled the run and why. */
  routing: RouteResult;
  /** Where the receipt was written, when persistence is enabled. */
  receiptPath?: string;
}

/* ------------------------------------------------------------------------- */

export class Harness {
  readonly config: AppConfig;
  readonly #log: Logger;

  #models!: ModelRegistry;
  #registry!: ToolRegistry;
  #guardrails!: GuardrailPipeline;
  #protocol!: ToolProtocol;
  #systemPrompt!: string;
  #egress: EgressGuard | null = null;
  #loopConfig!: LoopConfig;
  #memory: MemoryManager | null = null;
  #boot: HarnessBootReport | null = null;

  constructor(config: AppConfig, log: Logger = () => {}) {
    this.config = config;
    this.#log = log;
  }

  /** Assemble everything. Safe to call once; throws only on unrecoverable setup. */
  async start(overrides: { models?: ModelRegistry } = {}): Promise<HarnessBootReport> {
    const warnings: string[] = [];
    const cfg = this.config;

    /* --- 1. Egress guard, before anything can fetch -------------------- */

    if (cfg.egress.enforce) {
      this.#egress = new EgressGuard({
        allowlist: cfg.egress.allowlist,
        allowLoopback: cfg.egress.allowLoopback,
        onViolation: (attempt) =>
          this.#log("error", "egress violation refused", {
            host: attempt.host,
            reason: attempt.reason,
          }),
      });
      this.#egress.install();
      this.#log("info", "egress guard installed", {
        allowlist: cfg.egress.allowlist,
        allowLoopback: cfg.egress.allowLoopback,
      });
    } else {
      warnings.push(
        "EGRESS_ENFORCE is false — outbound network calls are NOT restricted. " +
          "This must not be used in the air-gapped deployment.",
      );
      this.#log("warn", "egress enforcement disabled");
    }

    /* --- 2. Model registry + capability probe of the default model ----- */

    this.#models = overrides.models ?? new ModelRegistry(cfg, this.#log);
    const planner = this.#models.defaultModel.provider;

    let health: HealthInfo = { reachable: false };
    try {
      health =
        planner instanceof LlamaCppProvider
          ? await planner.probeCapabilities()
          : await planner.health();
    } catch (err) {
      health = { reachable: false, detail: err instanceof Error ? err.message : String(err) };
    }

    // Probe every distinct server so the boot report shows what is actually up.
    const modelStatus = await this.#probeAll();

    if (!health.reachable) {
      warnings.push(
        `Default model server (${this.#models.defaultId}) is not reachable: ${health.detail ?? "no detail"}. ` +
          "The API will start but runs will fail until it is available.",
      );
      this.#log("error", "default model server unreachable");
    }

    const { protocol, mode, reason } = this.#chooseProtocol(health);
    this.#protocol = protocol;
    if (cfg.protocol.mode !== "auto" && cfg.protocol.mode !== mode) {
      warnings.push(`TOOL_PROTOCOL=${cfg.protocol.mode} was requested but ${mode} was used: ${reason}`);
    }

    /* --- 3. Memory layer ---------------------------------------------- */

    if (cfg.memory.enabled && cfg.embedding.enabled) {
      const embedder = new EmbeddingProvider({
        baseUrl: cfg.embedding.baseUrl,
        modelId: cfg.embedding.modelId,
        timeoutMs: cfg.embedding.timeoutMs,
        ...(cfg.embedding.apiKey ? { apiKey: cfg.embedding.apiKey } : {}),
      });
      const store = new MemoryStore(cfg.memory.dir);
      this.#memory = new MemoryManager(embedder, store, {
        topK: cfg.memory.topK,
        minScore: cfg.memory.minScore,
        log: (msg, extra) => this.#log("debug", msg, extra),
      });
      const embHealth = await embedder.health();
      if (!embHealth.reachable) {
        warnings.push(
          `Embedding server (${cfg.embedding.baseUrl}) is not reachable: ${embHealth.detail}. ` +
            "Memory retrieval will be skipped until it is available.",
        );
      }
      this.#log("info", "semantic memory enabled", { dir: cfg.memory.dir });
    }

    /* --- 4. Tools ------------------------------------------------------ */

    this.#registry = new ToolRegistry().registerAll(builtinFsTools as never[]);

    if (this.#memory) {
      this.#registry.register(createMemorySearchTool(this.#memory));
    }

    const search = cfg.webSearch;
    let searchHosts: string[] = [];
    if (search.enabled && search.apiKey) {
      searchHosts = [SEARCH_HOSTS[search.backend]];
      this.#registry.register(
        createWebSearchTool({
          backend: search.backend,
          apiKey: search.apiKey,
          maxResults: search.maxResults,
          timeoutMs: search.timeoutMs,
        }),
      );
      warnings.push(
        `web_search is ENABLED (${search.backend}, host ${searchHosts[0]}). This deployment is ` +
          "therefore NOT air-gapped: the agent can send a query string to a third party. " +
          "Disable WEB_SEARCH_ENABLED for the sovereign configuration.",
      );
      this.#log("warn", "web search tool registered", { backend: search.backend, host: searchHosts[0] });
    }

    /* --- 5. Guardrails ------------------------------------------------- */

    this.#guardrails = new GuardrailPipeline({
      failClosed: cfg.guardrails.failClosed,
      guardTimeoutMs: cfg.guardrails.guardTimeoutMs,
      onTrace: (stage, entry) => {
        if (entry.action !== "allow") this.#log("warn", "guardrail action", { stage, ...entry });
      },
    });

    const leakageTerms = [
      ...MRPL_LEAKAGE_TERMS,
      ...cfg.guardrails.customLeakageTerms,
      ...(search.enabled && search.apiKey ? [search.apiKey] : []),
    ];

    // Always-on built-in guards. These need no dependencies and are the real
    // protection: injection detection on inbound text, secret redaction on
    // outbound text and tool results, tool-permission and protected-path checks
    // on tool arguments.
    this.#guardrails
      .add(injectionGuard())
      .add(secretsGuard(leakageTerms))
      .addAll(
        toolSafetyGuards({
          policy: { deny: cfg.guardrails.deniedTools, allowedTiers: cfg.guardrails.allowedTiers },
        }),
      );

    // Optional external engine, layered on top when installed.
    let externalLoaded = false;
    let externalReason = "disabled by configuration";

    if (cfg.guardrails.useExternalEngine) {
      const { engine, outcome } = await loadExternalEngine({
        level: cfg.guardrails.level,
        outputBlockStrategy: "sanitize",
        customLeakageTerms: leakageTerms,
      });
      externalLoaded = outcome.loaded;
      externalReason = outcome.reason;
      if (engine) {
        this.#guardrails.addAll(externalEngineGuards(engine));
        this.#log("info", "@llm-guardrails/core engine active");
      } else {
        warnings.push(`@llm-guardrails/core engine unavailable (${outcome.reason}); built-in guards remain active.`);
        this.#log("warn", "@llm-guardrails/core engine unavailable", { reason: outcome.reason });
      }
    }

    /* --- 6. System prompt --------------------------------------------- */

    const tools = this.#registry.schemas();
    this.#systemPrompt = buildSystemPrompt(this.#protocol, tools, {
      agentName: "MRPL Sovereign Workbench",
      workspaceRoot: cfg.workspace.root,
      modelId: health.model ?? this.#models.defaultId,
      today: new Date().toISOString().slice(0, 10),
      ...(searchHosts.length > 0
        ? { networkAccess: { toolName: "web_search", hosts: searchHosts } }
        : {}),
    });

    this.#loopConfig = {
      ...cfg.loop,
      serverSupportsGrammar: health.supportsGrammar ?? cfg.loop.serverSupportsGrammar,
    };

    this.#boot = {
      defaultModel: this.#models.defaultId,
      models: modelStatus,
      routingEnabled: cfg.routing.enabled,
      health,
      protocolMode: mode,
      protocolReason: reason,
      guardrails: {
        external: externalLoaded,
        externalReason,
        guardCount:
          this.#guardrails.guardsFor("user_input").length +
          this.#guardrails.guardsFor("tool_args").length +
          this.#guardrails.guardsFor("tool_result").length +
          this.#guardrails.guardsFor("model_output").length,
      },
      egressEnforced: cfg.egress.enforce,
      memoryEnabled: this.#memory !== null,
      networkToolEnabled: searchHosts.length > 0,
      tools: this.#registry.names(),
      systemPromptChars: this.#systemPrompt.length,
      warnings,
    };

    for (const w of warnings) this.#log("warn", w);
    return this.#boot;
  }

  /** Probe each distinct model server for the boot report. */
  async #probeAll(): Promise<HarnessBootReport["models"]> {
    return Promise.all(
      this.#models.list().map(async ({ descriptor, provider }) => {
        let reachable = false;
        try {
          reachable = (await provider.health()).reachable;
        } catch {
          reachable = false;
        }
        return {
          id: descriptor.id,
          role: descriptor.role,
          endpoint: descriptor.endpoint,
          reachable,
        };
      }),
    );
  }

  #chooseProtocol(health: HealthInfo): {
    protocol: ToolProtocol;
    mode: "native" | "prompted";
    reason: string;
  } {
    const requested = this.config.protocol.mode;
    if (requested === "native") {
      return { protocol: new NativeToolProtocol(), mode: "native", reason: "explicitly configured" };
    }
    if (requested === "prompted") {
      return { protocol: new PromptedToolProtocol(), mode: "prompted", reason: "explicitly configured" };
    }
    if (health.supportsNativeTools === true) {
      return {
        protocol: new NativeToolProtocol(),
        mode: "native",
        reason: "server accepted a native tools payload during probing",
      };
    }
    return {
      protocol: new PromptedToolProtocol(),
      mode: "prompted",
      reason: health.reachable
        ? "server did not honour native tool calling; using in-prompt protocol"
        : "server unreachable at boot; defaulting to the protocol that always works",
    };
  }

  get boot(): HarnessBootReport {
    if (!this.#boot) throw new AgentError("PROVIDER_ERROR", "harness.start() has not completed");
    return this.#boot;
  }

  get systemPrompt(): string {
    return this.#systemPrompt;
  }

  get protocol(): ToolProtocol {
    return this.#protocol;
  }

  get registry(): ToolRegistry {
    return this.#registry;
  }

  /** Live health of the default model, re-probed. Used by /healthz. */
  async health(): Promise<HealthInfo> {
    try {
      return await this.#models.defaultModel.provider.health();
    } catch (err) {
      return { reachable: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  egressAttestation() {
    return this.#egress?.attestation();
  }

  /** Build loop deps for a specific provider (the routed model for this run). */
  #deps(provider: ModelProvider, overrides: Partial<LoopConfig> = {}): LoopDeps {
    return {
      provider,
      registry: this.#registry,
      guardrails: this.#guardrails,
      protocol: this.#protocol,
      systemPrompt: this.#systemPrompt,
      workspaceRoot: this.config.workspace.root,
      config: { ...this.#loopConfig, ...overrides },
      log: (msg, extra) => this.#log("debug", msg, extra),
    };
  }

  /**
   * Run a session: route to a model, retrieve memory, drive the loop while
   * yielding events and building the receipt, then record the outcome to memory.
   */
  async *run(
    req: RunRequest & { loopOverrides?: Partial<LoopConfig> },
  ): AsyncGenerator<AgentEvent, SessionResult, void> {
    /* Route: classify the task and pick the best model, else the planner. */
    const routing = resolveModel(this.#models.descriptors(), req.input, req.sessionId, {
      enabled: this.config.routing.enabled,
      defaultModelId: this.#models.defaultId,
    });
    const { provider } = this.#models.get(routing.modelId);
    this.#log("info", "run routed", {
      sessionId: req.sessionId,
      model: routing.modelId,
      taskType: routing.task.taskType,
      reason: routing.reason,
    });

    /* Retrieve: seed the conversation with relevant memories. */
    let history = req.history ?? [];
    if (this.#memory) {
      const hits = await this.#memory.retrieve(req.input, { sessionId: req.sessionId });
      const memoryMsg = MemoryManager.asContextMessage(hits);
      if (memoryMsg) history = [memoryMsg, ...history];
    }

    const runReq: RunRequest = {
      input: req.input,
      sessionId: req.sessionId,
      ...(history.length > 0 ? { history } : {}),
      ...(req.signal ? { signal: req.signal } : {}),
    };

    const builder = new ReceiptBuilder(req.sessionId);
    const it = runAgent(this.#deps(provider, req.loopOverrides ?? {}), runReq);

    let outcome: RunOutcome;
    while (true) {
      const next = await it.next();
      if (next.done) {
        outcome = next.value;
        break;
      }
      builder.append(next.value);
      yield next.value;
    }

    const receipt = builder.finalise(outcome, this.egressAttestation());
    const path = await this.#persist(receipt);

    /* Record: write the outcome back as episodic memory (best-effort). */
    if (this.#memory && outcome.text.trim().length > 0) {
      await this.#memory.recordRun(req.sessionId, req.input, outcome.text, {
        model: routing.modelId,
        taskType: routing.task.taskType,
      });
    }

    this.#log("info", "run complete", {
      runId: receipt.runId,
      model: routing.modelId,
      stopReason: outcome.stopReason,
      steps: outcome.steps,
      toolCalls: outcome.toolCallCount,
      tokens: outcome.usage.totalTokens,
    });

    return path === undefined
      ? { outcome, receipt, routing }
      : { outcome, receipt, routing, receiptPath: path };
  }

  /** Non-streaming convenience for the plain JSON route and for evals. */
  async runToCompletion(
    req: RunRequest & { loopOverrides?: Partial<LoopConfig> },
  ): Promise<SessionResult & { events: AgentEvent[] }> {
    const events: AgentEvent[] = [];
    const it = this.run(req);
    while (true) {
      const next = await it.next();
      if (next.done) return { ...next.value, events };
      events.push(next.value);
    }
  }

  async #persist(receipt: TrustReceipt): Promise<string | undefined> {
    const dir = this.config.audit.dir;
    if (dir.length === 0) return undefined;
    try {
      await mkdir(dir, { recursive: true });
      const jsonPath = join(dir, `${receipt.runId}.json`);
      await writeFile(jsonPath, JSON.stringify(receipt, null, 2), "utf8");
      await writeFile(join(dir, "audit.jsonl"), receiptToJsonl(receipt), { flag: "a", encoding: "utf8" });
      if (this.config.audit.writeMarkdown) {
        await writeFile(join(dir, `${receipt.runId}.md`), receiptToMarkdown(receipt), "utf8");
      }
      return jsonPath;
    } catch (err) {
      this.#log("error", "could not persist trust receipt", {
        dir,
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }

  /** Release the fetch patch. Tests and hot reload need this. */
  stop(): void {
    this.#egress?.uninstall();
    this.#egress = null;
  }
}

/* ------------------------------------------------------------------------- */

export { DEFAULT_LOOP_CONFIG };
export type { Message };
