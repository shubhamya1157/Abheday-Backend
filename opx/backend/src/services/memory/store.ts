// The vector store — a plain JSON file on disk, searched by cosine similarity.
//
// WHY A JSON FILE, not sqlite / a vector DB: the deployment is air-gapped and
// must build with ZERO native modules. better-sqlite3 / hnswlib need a C++
// toolchain at install time, which is exactly what we cannot assume on a
// locked-down on-prem box. For the scale a single operator generates (thousands
// of memories, not millions), a linear cosine scan over an in-memory array is
// instant and has no dependencies. If it ever outgrows that, this one file is
// the only thing that has to change — nothing above it knows how it stores.
//
// The blueprint's four memory kinds are modelled as a `kind` tag on each record:
//   short-term   working notes for the current session
//   episodic     what happened on past runs (input + answer)
//   project      durable facts about the codebase / domain
//   long-term    user preferences and standing instructions

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { cosineSimilarity } from "./cosine.ts";

export type MemoryKind = "short-term" | "episodic" | "project" | "long-term";

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  /** The text that was embedded — what gets injected back into a prompt. */
  text: string;
  /** The embedding vector. */
  vector: number[];
  /** Which session created it. */
  sessionId: string;
  createdAt: string;
  /** Free-form tags for filtering (e.g. file paths, task type). */
  metadata?: Record<string, unknown>;
}

export interface MemoryHit {
  record: MemoryRecord;
  score: number;
}

export interface SearchOptions {
  topK: number;
  minScore: number;
  /** Restrict the search to certain kinds. */
  kinds?: MemoryKind[];
  /** Restrict to one session (used for short-term memory). */
  sessionId?: string;
}

/**
 * Loads once, holds records in memory, writes the whole file on change.
 * Writes are serialised through a promise chain so two concurrent runs can't
 * clobber each other's file.
 */
export class MemoryStore {
  readonly #dir: string;
  readonly #file: string;
  #records: MemoryRecord[] = [];
  #loaded = false;
  #writeChain: Promise<void> = Promise.resolve();

  constructor(dir: string) {
    this.#dir = resolve(dir);
    this.#file = join(this.#dir, "memory.json");
  }

  async #ensureLoaded(): Promise<void> {
    if (this.#loaded) return;
    try {
      const raw = await readFile(this.#file, "utf8");
      const parsed: unknown = JSON.parse(raw);
      this.#records = Array.isArray(parsed) ? (parsed as MemoryRecord[]) : [];
    } catch {
      // First run — no file yet. Start empty.
      this.#records = [];
    }
    this.#loaded = true;
  }

  #persist(): Promise<void> {
    const snapshot = JSON.stringify(this.#records, null, 2);
    this.#writeChain = this.#writeChain.then(async () => {
      await mkdir(this.#dir, { recursive: true });
      await writeFile(this.#file, snapshot, "utf8");
    });
    return this.#writeChain;
  }

  /** Add one memory. Returns the stored record (with its generated id). */
  async add(
    input: Omit<MemoryRecord, "id" | "createdAt"> & { id?: string; createdAt?: string },
  ): Promise<MemoryRecord> {
    await this.#ensureLoaded();
    const record: MemoryRecord = {
      id: input.id ?? randomUUID(),
      kind: input.kind,
      text: input.text,
      vector: input.vector,
      sessionId: input.sessionId,
      createdAt: input.createdAt ?? new Date().toISOString(),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    };
    this.#records.push(record);
    await this.#persist();
    return record;
  }

  /**
   * Rank every (optionally filtered) memory against the query vector and return
   * the best matches above the score floor.
   */
  async search(queryVector: number[], opts: SearchOptions): Promise<MemoryHit[]> {
    await this.#ensureLoaded();
    const kinds = opts.kinds ? new Set(opts.kinds) : null;

    const hits: MemoryHit[] = [];
    for (const record of this.#records) {
      if (kinds && !kinds.has(record.kind)) continue;
      if (opts.sessionId && record.sessionId !== opts.sessionId) continue;
      const score = cosineSimilarity(queryVector, record.vector);
      if (score >= opts.minScore) hits.push({ record, score });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, opts.topK);
  }

  /** Drop a session's short-term (working) memory when it ends. */
  async clearSession(sessionId: string, kind: MemoryKind = "short-term"): Promise<number> {
    await this.#ensureLoaded();
    const before = this.#records.length;
    this.#records = this.#records.filter(
      (r) => !(r.sessionId === sessionId && r.kind === kind),
    );
    const removed = before - this.#records.length;
    if (removed > 0) await this.#persist();
    return removed;
  }

  async count(): Promise<number> {
    await this.#ensureLoaded();
    return this.#records.length;
  }
}
