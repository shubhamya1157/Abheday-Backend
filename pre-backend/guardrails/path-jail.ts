
// what does this guarrails do -- Take a path supplied by an agent/user, make sure it stays inside an allowed workspace folder, and prevent tricks such as ../ paths or symlinks from escaping that folder

import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";

export interface PathDecision {
  ok: boolean;
  path: string;
  relative: string;
  reason: string;
}



//Is childAbs actually inside rootAbs?
export function isInside(rootAbs: string, childAbs: string): boolean {
  const r = resolve(rootAbs).replace(new RegExp(`\\${sep}+$`), "");
  const c = resolve(childAbs).replace(new RegExp(`\\${sep}+$`), "");
  return c === r || c.startsWith(r + sep);
}

/** Layer 1: String-level path validation (no disk I/O) */
export function resolveInsideRoot(root: string, candidate: string): PathDecision {
  const rootAbs = resolve(root);

  if (!candidate || typeof candidate !== "string") {
    return { ok: false, path: "", relative: "", reason: "Path must not be empty" };
  }
  if (candidate.includes("\0")) {
    return { ok: false, path: "", relative: "", reason: "Path contains invalid NUL byte" };
  }

  const abs = normalize(isAbsolute(candidate) ? candidate : join(rootAbs, candidate));
  if (!isInside(rootAbs, abs)) {
    return { ok: false, path: "", relative: "", reason: `Path "${candidate}" escapes workspace root` };
  }

  return { ok: true, path: abs, relative: relative(rootAbs, abs) || ".", reason: "ok" };
}

/** Layer 2: Symlink-aware verification against disk */
export async function assertRealPathInside(rootAbs: string, absPath: string): Promise<PathDecision> {
  const realRoot = await realpath(rootAbs).catch(() => rootAbs);

  // Find nearest existing ancestor (for new files that don't exist yet)
  let probe = absPath;
  let existing: string | null = null;
  while (probe !== resolve(probe, "..")) {
    const real = await realpath(probe).catch(() => null);
    if (real !== null) {
      existing = real;
      break;
    }
    probe = resolve(probe, "..");
  }

  if (!existing) {
    return { ok: false, path: "", relative: "", reason: "Cannot resolve ancestor path" };
  }

  const remainder = relative(probe, absPath);
  const realCandidate = remainder ? join(existing, remainder) : existing;

  if (!isInside(realRoot, realCandidate)) {
    return { ok: false, path: "", relative: "", reason: "Path escapes workspace root via symlink" };
  }

  return {
    ok: true,
    path: realCandidate,
    relative: relative(realRoot, realCandidate) || ".",
    reason: "ok",
  };
}

/** Complete path validation used by all filesystem tools */
export async function requireSafePath(
  root: string,
  candidate: string,
): Promise<{ abs: string; rel: string }> {
  const textual = resolveInsideRoot(root, candidate);
  if (!textual.ok) throw new Error(`Path rejected: ${textual.reason}`);

  const real = await assertRealPathInside(resolve(root), textual.path);
  if (!real.ok) throw new Error(`Path rejected: ${real.reason}`);

  return { abs: real.path, rel: textual.relative };
}
