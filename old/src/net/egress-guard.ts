/**
 * EGRESS GUARD — the sovereignty enforcement point.
 *
 * SIH26117 is graded on the trust boundary, not the model. The stated proof is
 * "logs / network monitor showing zero external calls". A network monitor proves
 * it from outside; this module proves it from *inside* the process and produces
 * an attestation you can print next to the artifact.
 *
 * Mechanism: replace globalThis.fetch with a wrapper that resolves the target
 * host against an allowlist (by default: loopback only). Anything else throws
 * EGRESS_BLOCKED and is recorded as a violation. Because every layer above is
 * forbidden from using vendor SDKs, ALL model traffic goes through fetch, so
 * this single choke point covers the whole application.
 *
 * The host-matching logic is deliberately a pure exported function so it can be
 * adversarially unit-tested (see tests/egress-guard.test.ts) — hostname
 * allowlisting is exactly the kind of code that looks right and isn't.
 */

import { AgentError } from "../core/types.ts";

export interface EgressAttempt {
  at: string;
  url: string;
  host: string;
  allowed: boolean;
  /** Why it was allowed or refused — goes straight into the Trust Receipt. */
  reason: string;
}

export interface EgressAttestation {
  enforced: boolean;
  allowlist: string[];
  totalRequests: number;
  allowedRequests: number;
  blockedRequests: number;
  /** Every denied attempt, verbatim. Empty array is the thing you want to show. */
  violations: EgressAttempt[];
  generatedAt: string;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/**
 * Normalise a hostname for comparison.
 * Strips brackets from IPv6 literals, lowercases, and removes a single trailing
 * dot (the FQDN root). "EXAMPLE.COM." and "example.com" must not be treated as
 * different hosts, or an allowlist bypass exists.
 */
export function normaliseHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.endsWith(".")) h = h.slice(0, -1);
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  return h;
}

/** True when `host` is a loopback address or name. */
export function isLoopbackHost(host: string): boolean {
  const h = normaliseHost(host);
  if (LOOPBACK_HOSTS.has(h)) return true;
  // Entire 127.0.0.0/8 block is loopback, not just 127.0.0.1.
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) {
    return h.split(".").every((o) => Number(o) >= 0 && Number(o) <= 255);
  }
  return false;
}

export interface EgressDecision {
  allowed: boolean;
  host: string;
  reason: string;
}

/**
 * Decide whether a URL may be fetched.
 *
 * Rules, in order:
 *  1. Non-http(s) schemes are refused outright (file:, data:, ftp: — a
 *     file:// fetch would exfiltrate local data past a network monitor).
 *  2. Loopback hosts are allowed when allowLoopback is true.
 *  3. Otherwise the host must appear in the allowlist as an EXACT match.
 *
 * Note the deliberate absence of suffix matching. Allowing "*.corp.local" via
 * endsWith() would let "evil-corp.local" through; if you need subdomains, add
 * them explicitly.
 */
export function evaluateEgress(
  rawUrl: string,
  allowlist: readonly string[],
  allowLoopback = true,
): EgressDecision {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { allowed: false, host: "<unparseable>", reason: "URL could not be parsed" };
  }

  const scheme = parsed.protocol.replace(":", "").toLowerCase();
  if (scheme !== "http" && scheme !== "https") {
    return {
      allowed: false,
      host: normaliseHost(parsed.hostname),
      reason: `scheme "${scheme}" is not permitted (only http/https)`,
    };
  }

  const host = normaliseHost(parsed.hostname);
  if (host.length === 0) {
    return { allowed: false, host, reason: "empty hostname" };
  }

  if (allowLoopback && isLoopbackHost(host)) {
    return { allowed: true, host, reason: "loopback host" };
  }

  for (const entry of allowlist) {
    if (normaliseHost(entry) === host) {
      return { allowed: true, host, reason: `explicit allowlist entry "${entry}"` };
    }
  }

  return { allowed: false, host, reason: "host is not on the egress allowlist" };
}

/* ------------------------------------------------------------------------- */

export interface EgressGuardOptions {
  /** Exact hostnames permitted in addition to loopback. Usually empty. */
  allowlist?: readonly string[];
  allowLoopback?: boolean;
  /** Record allowed calls too. Costs memory on long runs; great for demos. */
  recordAllowed?: boolean;
  onViolation?: (attempt: EgressAttempt) => void;
}

/**
 * Process-wide egress guard. Instantiate once in src/index.ts BEFORE anything
 * else runs, then call install().
 */
export class EgressGuard {
  private readonly allowlist: string[];
  private readonly allowLoopback: boolean;
  private readonly recordAllowed: boolean;
  private readonly onViolation: ((a: EgressAttempt) => void) | undefined;

  private originalFetch: typeof globalThis.fetch | null = null;
  private attempts: EgressAttempt[] = [];
  private allowedCount = 0;
  private blockedCount = 0;

  constructor(opts: EgressGuardOptions = {}) {
    this.allowlist = [...(opts.allowlist ?? [])];
    this.allowLoopback = opts.allowLoopback ?? true;
    this.recordAllowed = opts.recordAllowed ?? false;
    this.onViolation = opts.onViolation;
  }

  get enforced(): boolean {
    return this.originalFetch !== null;
  }

  /** Monkey-patch global fetch. Idempotent. */
  install(): void {
    if (this.originalFetch) return;
    // Keep the untouched reference for uninstall, and a bound copy for calling.
    // Restoring a bound copy instead would leave globalThis.fetch as a *different*
    // function object after an install/uninstall cycle, so the invariant "the
    // process ends up exactly as it started" would quietly not hold.
    const original = globalThis.fetch;
    this.originalFetch = original;
    const delegate = original.bind(globalThis);

    const guard = this;
    globalThis.fetch = async function guardedFetch(
      input: string | URL | globalThis.Request,
      init?: RequestInit,
    ): Promise<Response> {
      const url = extractUrl(input);
      const decision = evaluateEgress(url, guard.allowlist, guard.allowLoopback);
      const attempt: EgressAttempt = {
        at: new Date().toISOString(),
        url: redactUrl(url),
        host: decision.host,
        allowed: decision.allowed,
        reason: decision.reason,
      };

      if (!decision.allowed) {
        guard.blockedCount += 1;
        guard.attempts.push(attempt);
        guard.onViolation?.(attempt);
        throw new AgentError(
          "EGRESS_BLOCKED",
          `Egress blocked: ${decision.host} — ${decision.reason}. ` +
            `This deployment is air-gapped by policy.`,
          { detail: { url: attempt.url, host: decision.host } },
        );
      }

      guard.allowedCount += 1;
      if (guard.recordAllowed) guard.attempts.push(attempt);
      return delegate(input, init);
    } as typeof globalThis.fetch;
  }

  /** Restore the original fetch. Only used in tests. */
  uninstall(): void {
    if (this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
    }
  }

  /** Embed this in the Trust Receipt of every artifact the system produces. */
  attestation(): EgressAttestation {
    return {
      enforced: this.enforced,
      allowlist: this.allowLoopback ? ["<loopback>", ...this.allowlist] : [...this.allowlist],
      totalRequests: this.allowedCount + this.blockedCount,
      allowedRequests: this.allowedCount,
      blockedRequests: this.blockedCount,
      violations: this.attempts.filter((a) => !a.allowed),
      generatedAt: new Date().toISOString(),
    };
  }

  reset(): void {
    this.attempts = [];
    this.allowedCount = 0;
    this.blockedCount = 0;
  }
}

function extractUrl(input: string | URL | globalThis.Request): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Strip query strings and credentials before logging — they carry secrets. */
function redactUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.search = "";
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "<unparseable>";
  }
}
