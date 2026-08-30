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
import type { AppConfig } from "../config.ts";
import { AgentError, type HealthInfo, type Message, type ModelProvider } from "../core/types.ts";
import { toolSafetyGuards } from "../guardrails/builtin-guards.ts";
import { externalEngineGuards, loadExternalEngine, MRPL_LEAKAGE_TERMS } from "../guardrails/core-adapter.ts";
import { GuardrailPipeline } from "../guardrails/pipeline.ts";
import { EgressGuard } from "../net/egress-guard.ts";
import { LlamaCppProvider } from "../provider/llama-provider.ts";
import { buildSystemPrompt } from "../prompt/system-prompt.ts";
import { NativeToolProtocol } from "../protocol/native.ts";
import { PromptedToolProtocol } from "../protocol/prompted.ts";
import type { ToolProtocol } from "../protocol/types.ts";
import { builtinFsTools } from "../tools/builtin.ts";
import { ToolRegistry } from "../tools/registry.ts";
import { createWebSearchTool, SEARCH_HOSTS } from "../tools/web-search.ts";



// Log type declaring
export type Logger = (
  level: "debug" | "info" | "warn" | "error",
  msg: string,
  extra?: Record<string, unknown>,
) => void;




export interface HarnessBootReport {
  provider: string;
  health: HealthInfo;
  protocolMode: "native" | "prompted";
  protocolReason: string;
  guardrails: { external: boolean; externalReason: string; guardCount: number };
  egressEnforced: boolean;
  /** True when the search tool is registered, i.e. the deployment is not air-gapped. */
  networkToolEnabled: boolean;
  tools: string[];
  systemPromptChars: number;
  warnings: string[];
}

export interface SessionResult {
  outcome: RunOutcome;
  receipt: TrustReceipt;
  /** Where the receipt was written, when persistence is enabled. */
  receiptPath?: string;
}

/* ------------------------------------------------------------------------- */

export class Harness {
  readonly config: AppConfig;
  readonly #log: Logger;

  #provider!: ModelProvider;
  #registry!: ToolRegistry;
  #guardrails!: GuardrailPipeline;
  #protocol!: ToolProtocol;
  #systemPrompt!: string;
  #egress: EgressGuard | null = null;
  #loopConfig!: LoopConfig;
  #boot: HarnessBootReport | null = null;

  constructor(config: AppConfig, log: Logger = () => {}) {
    this.config = config;
    this.#log = log;
  }

  /** Assemble everything. Safe to call once; throws only on unrecoverable setup. */
  async start(overrides: { provider?: ModelProvider } = {}): Promise<HarnessBootReport> {
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
      // Loud, because a deployment claiming sovereignty with this off is lying.
      warnings.push(
        "EGRESS_ENFORCE is false — outbound network calls are NOT restricted. " +
          "This must not be used in the air-gapped deployment.",
      );
      this.#log("warn", "egress enforcement disabled");
    }

    /* --- 2. Provider and capability probe ------------------------------ */

    this.#provider =
      overrides.provider ??
      new LlamaCppProvider({
        baseUrl: cfg.model.baseUrl,
        model: cfg.model.modelId,
        requestTimeoutMs: cfg.model.requestTimeoutMs,
        maxRetries: cfg.model.maxRetries,
        cachePrompt: cfg.model.cachePrompt,
        defaultTemperature: cfg.loop.temperature,
        defaultMaxTokens: cfg.loop.maxOutputTokens,
        ...(cfg.model.apiKey ? { apiKey: cfg.model.apiKey } : {}),
        onRequestLog: (info) => this.#log("debug", "model request", { ...info }),
      });

    let health: HealthInfo = { reachable: false };
    try {
      health =
        this.#provider instanceof LlamaCppProvider
          ? await this.#provider.probeCapabilities()
          : await this.#provider.health();
    } catch (err) {
      health = {
        reachable: false,
        detail: err instanceof Error ? err.message : String(err),
      };
    }

    if (!health.reachable) {
      // Do NOT throw. The server must still boot so /healthz can explain what is
      // wrong — a backend that refuses to start because the model is not up yet
      // is far harder to debug than one that starts and reports the problem.
      warnings.push(
        `Model server at ${cfg.model.baseUrl} is not reachable: ${health.detail ?? "no detail"}. ` +
          "The API will start but runs will fail until it is available.",
      );
      this.#log("error", "model server unreachable", { baseUrl: cfg.model.baseUrl });
    }

    const { protocol, mode, reason } = this.#chooseProtocol(health);
    this.#protocol = protocol;
    if (cfg.protocol.mode !== "auto" && cfg.protocol.mode !== mode) {
      warnings.push(`TOOL_PROTOCOL=${cfg.protocol.mode} was requested but ${mode} was used: ${reason}`);
    }

    /* --- 3. Tools ------------------------------------------------------ */

    this.#registry = new ToolRegistry().registerAll(builtinFsTools as never[]);

    // Web search is registered only when configured, so the default catalogue is
    // the air-gapped one. Registering it is what makes the deployment non-air-gapped,
    // and that must be visible in the boot report rather than buried in .env.
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
      this.#log("warn", "web search tool registered", {
        backend: search.backend,
        host: searchHosts[0],
      });
    }

    /* --- 4. Guardrails ------------------------------------------------- */

    this.#guardrails = new GuardrailPipeline({
      failClosed: cfg.guardrails.failClosed,
      guardTimeoutMs: cfg.guardrails.guardTimeoutMs,
      onTrace: (stage, entry) => {
        if (entry.action !== "allow") {
          this.#log("warn", "guardrail action", { stage, ...entry });
        }
      },
    });

    const leakageTerms = [
      ...MRPL_LEAKAGE_TERMS,
      ...cfg.guardrails.customLeakageTerms,
      // The search key is a live credential that now exists in this process. Add
      // it as a leakage term so the secrets guard scrubs it from any tool result
      // or model output — an error page that echoes the query string back must not
      // be able to write the key into a file or into the receipt.
      ...(search.enabled && search.apiKey ? [search.apiKey] : []),
    ];

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
        warnings.push(
          `@llm-guardrails/core engine unavailable (${outcome.reason}).`,
        );
        this.#log("warn", "@llm-guardrails/core engine unavailable", { reason: outcome.reason });
      }
    }

    // Tool safety guards: enforce tool permissions and protected file paths on tool_args
    this.#guardrails.addAll(
      toolSafetyGuards({
        policy: {
          deny: cfg.guardrails.deniedTools,
          allowedTiers: cfg.guardrails.allowedTiers,
        },
      }),
    );

    /* --- 5. System prompt (depends on 2 and 3) ------------------------- */

    const tools = this.#registry.schemas();
    this.#systemPrompt = buildSystemPrompt(this.#protocol, tools, {
      agentName: "MRPL Sovereign Workbench",
      workspaceRoot: cfg.workspace.root,
      modelId: health.model ?? cfg.model.modelId,
      today: new Date().toISOString().slice(0, 10),
      // Without this the prompt would assert "there is no internet access" while
      // advertising a search tool, and the model would have to pick which of its
      // instructions to believe.
      ...(searchHosts.length > 0
        ? { networkAccess: { toolName: "web_search", hosts: searchHosts } }
        : {}),
    });

    this.#loopConfig = {
      ...cfg.loop,
      // Trust the probe over the env var: a grammar sent to a server that does
      // not support it fails the whole request, and it only fails on the repair
      // path, i.e. when something has already gone wrong.
      serverSupportsGrammar: health.supportsGrammar ?? cfg.loop.serverSupportsGrammar,
    };

    this.#boot = {
      provider: this.#provider.id,
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
      networkToolEnabled: searchHosts.length > 0,
      tools: this.#registry.names(),
      systemPromptChars: this.#systemPrompt.length,
      warnings,
    };

    for (const w of warnings) this.#log("warn", w);
    return this.#boot;
  }

  /**
   * Native mode is preferred when the server proves it works, because the server
   * handles the grammar for us. Prompted mode is the fallback that always works.
   */
  #chooseProtocol(health: HealthInfo): {
    protocol: ToolProtocol;
    mode: "native" | "prompted";
    reason: string;
  } {
    const requested = this.config.protocol.mode;

    if (requested === "native") {
      return {
        protocol: new NativeToolProtocol(),
        mode: "native",
        reason: "explicitly configured",
      };
    }
    if (requested === "prompted") {
      return {
        protocol: new PromptedToolProtocol(),
        mode: "prompted",
        reason: "explicitly configured",
      };
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

  /** Live health, re-probed. Used by /healthz. */
  async health(): Promise<HealthInfo> {
    try {
      return await this.#provider.health();
    } catch (err) {
      return { reachable: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Egress evidence for the receipt and for /healthz. */
  egressAttestation() {
    return this.#egress?.attestation();
  }

  #deps(overrides: Partial<LoopConfig> = {}): LoopDeps {
    return {
      provider: this.#provider,
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
   * Run a session, yielding events AND building the receipt as it goes.
   *
   * The receipt is built from the events being yielded, not from a second pass,
   * so what the operator saw and what the audit records cannot diverge.
   */
  async *run(
    req: RunRequest & { loopOverrides?: Partial<LoopConfig> },
  ): AsyncGenerator<AgentEvent, SessionResult, void> {
    const builder = new ReceiptBuilder(req.sessionId);
    const it = runAgent(this.#deps(req.loopOverrides ?? {}), req);

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

    this.#log("info", "run complete", {
      runId: receipt.runId,
      stopReason: outcome.stopReason,
      steps: outcome.steps,
      toolCalls: outcome.toolCallCount,
      tokens: outcome.usage.totalTokens,
    });

    return path === undefined ? { outcome, receipt } : { outcome, receipt, receiptPath: path };
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

  /**
   * Persist the receipt. Failure to write must never fail the run — the operator
   * has already got their answer, and losing the audit file is a lesser problem
   * that we report rather than escalate.
   */
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

/** Default loop config, exported so the eval script can reuse it. */
export { DEFAULT_LOOP_CONFIG };
export type { Message };
