
//stat --> Gets information about a file or directory.
//dirname() --> Gets the parent directory
//relative() --> Gets a path relative to another path


import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { defineTool, type ToolDefinition } from "./registry.ts";
import { requireSafePath, resolveInsideRoot } from "../guardrails/path-jail.ts";


const IGNORED_DIRS = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".venv", "venv", ".cache", "coverage", ".turbo",
]);



// Creating a tool
export const readFileTool = defineTool<{ path: string; start_line?: number; end_line?: number }>({
  name: "read_file",
  description:
    "Read a UTF-8 text file from the workspace. Returns the content with 1-based line " +
    "numbers prefixed, so you can refer to specific lines afterwards. Use start_line and " +
    "end_line to read part of a large file. Always read a file before editing it.",
  tier: "read",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the workspace root." },
      start_line: { type: "integer", description: "First line to return (1-based).", minimum: 1 },
      end_line: { type: "integer", description: "Last line to return, inclusive.", minimum: 1 },
    },
    required: ["path"],
    additionalProperties: false,
  },
  timeoutMs: 100000,


  //Implementation 
  async handler(args, ctx) {
    const { abs, rel } = await requireSafePath(ctx.workspaceRoot, args.path);

    const info = await stat(abs).catch(() => null);
    if (!info) throw new Error(`File not found: ${args.path}`);
    if (info.isDirectory()) {
      throw new Error(`${args.path} is a directory. Use list_dir to see its contents.`);
    }
    // 5 MB guard: reading a binary blob would fill the context with mojibake.
    if (info.size > 5_000_000) {
      throw new Error(
        `File is ${(info.size / 1e6).toFixed(1)} MB, too large to read. Use grep to search it.`,
      );
    }

    const raw = await readFile(abs, "utf8");
    if (raw.includes("\0")) {
      throw new Error(`${args.path} appears to be a binary file, not text.`);
    }

    const lines = raw.split("\n");
    const start = Math.max(1, args.start_line ?? 1);
    const end = Math.min(lines.length, args.end_line ?? lines.length);
    if (start > lines.length) {
      throw new Error(`start_line ${start} is past the end of the file (${lines.length} lines).`);
    }

    const width = String(end).length;
    const body = lines
      .slice(start - 1, end)
      .map((line, i) => `${String(start + i).padStart(width, " ")}\t${line}`)
      .join("\n");

    const header =
      start === 1 && end === lines.length
        ? `${rel} (${lines.length} lines)`
        : `${rel} (lines ${start}-${end} of ${lines.length})`;

    return { content: `${header}\n${body}`, data: { path: rel, lines: lines.length } };
  },
});

/* ------------------------------------------------------------------------- */

export const writeFileTool = defineTool<{ path: string; content: string }>({
  name: "write_file",
  description:
    "Create a file or completely overwrite an existing one. Parent directories are created " +
    "automatically. This REPLACES the whole file — to change part of an existing file use " +
    "edit_file instead, which is safer because it fails if the target text is not found.",
  tier: "write",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the workspace root." },
      content: { type: "string", description: "Full file content to write." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  timeoutMs: 15_000,
  async handler(args, ctx) {
    const { abs, rel } = await requireSafePath(ctx.workspaceRoot, args.path);

    const existing = await stat(abs).catch(() => null);
    if (existing?.isDirectory()) throw new Error(`${args.path} is a directory.`);

    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, args.content, "utf8");

    const lineCount = args.content.split("\n").length;
    const verb = existing ? "Overwrote" : "Created";
    ctx.log(`write_file ${verb.toLowerCase()} ${rel}`, { bytes: args.content.length });

    return {
      content: `${verb} ${rel} (${lineCount} lines, ${args.content.length} bytes).`,
      data: { path: rel, bytes: args.content.length, created: !existing },
    };
  },
});

/* ------------------------------------------------------------------------- */

export const editFileTool = defineTool<{
  path: string;
  old_text: string;
  new_text: string;
  replace_all?: boolean;
}>({
  name: "edit_file",
  description:
    "Replace an exact string in a file. old_text must match the file EXACTLY, including " +
    "indentation and line breaks, and must be unique unless replace_all is true. Prefer this " +
    "over write_file for changing existing files: if old_text is not found or is ambiguous the " +
    "edit fails safely instead of destroying content. Read the file first to get exact text.",
  tier: "write",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Path relative to the workspace root." },
      old_text: { type: "string", description: "Exact existing text to replace." },
      new_text: { type: "string", description: "Replacement text." },
      replace_all: {
        type: "boolean",
        description: "Replace every occurrence instead of requiring uniqueness.",
        default: false,
      },
    },
    required: ["path", "old_text", "new_text"],
    additionalProperties: false,
  },
  timeoutMs: 15_000,
  async handler(args, ctx) {
    const { abs, rel } = await requireSafePath(ctx.workspaceRoot, args.path);

    const info = await stat(abs).catch(() => null);
    if (!info) throw new Error(`File not found: ${args.path}`);
    if (info.isDirectory()) throw new Error(`${args.path} is a directory.`);

    const original = await readFile(abs, "utf8");

    if (args.old_text === args.new_text) {
      throw new Error("old_text and new_text are identical; nothing to change.");
    }

    const occurrences = countOccurrences(original, args.old_text);
    if (occurrences === 0) {
      // Actionable diagnosis: whitespace mismatch is by far the usual cause.
      const collapsed = countOccurrences(
        original.replace(/\s+/g, " "),
        args.old_text.replace(/\s+/g, " "),
      );
      const hint =
        collapsed > 0
          ? " The text exists but with different whitespace or indentation — re-read the file and copy the exact characters."
          : " Re-read the file to confirm the current contents.";
      throw new Error(`old_text was not found in ${rel}.${hint}`);
    }
    if (occurrences > 1 && args.replace_all !== true) {
      throw new Error(
        `old_text appears ${occurrences} times in ${rel}. Include more surrounding context to ` +
          `make it unique, or set replace_all to true.`,
      );
    }

    const updated = args.replace_all
      ? original.split(args.old_text).join(args.new_text)
      : original.replace(args.old_text, args.new_text);

    await writeFile(abs, updated, "utf8");
    ctx.log(`edit_file ${rel}`, { occurrences });

    return {
      content: `Edited ${rel} — replaced ${occurrences} occurrence${occurrences === 1 ? "" : "s"}.`,
      data: { path: rel, occurrences },
    };
  },
});

/* ------------------------------------------------------------------------- */

export const listDirTool = defineTool<{ path?: string; recursive?: boolean }>({
  name: "list_dir",
  description:
    "List the contents of a directory. Use this to orient yourself before reading files. " +
    "Directories are marked with a trailing slash. Dependency and build directories such as " +
    "node_modules and .git are skipped.",
  tier: "read",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory relative to the workspace root. Defaults to the root.",
        default: ".",
      },
      recursive: {
        type: "boolean",
        description: "Descend into subdirectories (max depth 3).",
        default: false,
      },
    },
    required: [],
    additionalProperties: false,
  },
  timeoutMs: 15_000,
  async handler(args, ctx) {
    const target = args.path && args.path.length > 0 ? args.path : ".";
    const { abs, rel } = await requireSafePath(ctx.workspaceRoot, target);

    const info = await stat(abs).catch(() => null);
    if (!info) throw new Error(`Directory not found: ${target}`);
    if (!info.isDirectory()) {
      throw new Error(`${target} is a file, not a directory. Use read_file.`);
    }

    const entries: string[] = [];
    const maxEntries = 500;

    async function walk(dir: string, depth: number): Promise<void> {
      if (entries.length >= maxEntries) return;
      const items = await readdir(dir, { withFileTypes: true });
      items.sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      for (const item of items) {
        if (entries.length >= maxEntries) return;
        if (IGNORED_DIRS.has(item.name)) continue;

        const full = join(dir, item.name);
        const display = relative(abs, full) || item.name;

        if (item.isDirectory()) {
          entries.push(`${display}/`);
          if (args.recursive === true && depth < 3) await walk(full, depth + 1);
        } else {
          entries.push(display);
        }
      }
    }

    await walk(abs, 0);

    if (entries.length === 0) return { content: `${rel} is empty.`, data: { count: 0 } };
    const capped = entries.length >= maxEntries ? `\n… (listing capped at ${maxEntries} entries)` : "";
    return {
      content: `${rel} — ${entries.length} entries:\n${entries.join("\n")}${capped}`,
      data: { count: entries.length },
    };
  },
});

/* ------------------------------------------------------------------------- */

export const grepTool = defineTool<{
  pattern: string;
  path?: string;
  glob?: string;
  max_results?: number;
  ignore_case?: boolean;
}>({
  name: "grep",
  description:
    "Search file contents with a JavaScript regular expression. Returns matching lines with " +
    "their file path and line number. Use this to locate code or text when you do not know " +
    "which file it is in — it is much cheaper than reading many files.",
  tier: "read",
  parameters: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "JavaScript regular expression." },
      path: { type: "string", description: "Directory to search. Defaults to the root.", default: "." },
      glob: {
        type: "string",
        description: 'Filename filter, e.g. "*.ts". Simple * wildcard only.',
      },
      max_results: { type: "integer", description: "Cap on matches.", default: 60, minimum: 1, maximum: 300 },
      ignore_case: { type: "boolean", description: "Case-insensitive search.", default: false },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  timeoutMs: 30_000,
  async handler(args, ctx) {
    const target = args.path && args.path.length > 0 ? args.path : ".";
    const { abs } = await requireSafePath(ctx.workspaceRoot, target);

    let re: RegExp;
    try {
      re = new RegExp(args.pattern, args.ignore_case ? "i" : "");
    } catch (err) {
      throw new Error(
        `Invalid regular expression "${args.pattern}": ${err instanceof Error ? err.message : "parse error"}`,
      );
    }

    const nameFilter = args.glob ? globToRegExp(args.glob) : null;
    const limit = args.max_results ?? 60;
    const matches: string[] = [];
    let filesScanned = 0;

    async function walk(dir: string, depth: number): Promise<void> {
      if (matches.length >= limit || depth > 8 || ctx.signal.aborted) return;
      const items = await readdir(dir, { withFileTypes: true }).catch(() => []);

      for (const item of items) {
        if (matches.length >= limit || ctx.signal.aborted) return;
        if (IGNORED_DIRS.has(item.name)) continue;
        const full = join(dir, item.name);

        if (item.isDirectory()) {
          await walk(full, depth + 1);
          continue;
        }
        if (nameFilter && !nameFilter.test(item.name)) continue;

        const info = await stat(full).catch(() => null);
        if (!info || info.size > 2_000_000) continue;

        const content = await readFile(full, "utf8").catch(() => null);
        if (content === null || content.includes("\0")) continue;
        filesScanned++;

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= limit) break;
          const line = lines[i];
          if (line !== undefined && re.test(line)) {
            const shown = line.length > 200 ? `${line.slice(0, 200)}…` : line;
            matches.push(`${relative(ctx.workspaceRoot, full)}:${i + 1}: ${shown.trim()}`);
          }
        }
      }
    }

    await walk(abs, 0);

    if (matches.length === 0) {
      return {
        content: `No matches for /${args.pattern}/ in ${filesScanned} files.`,
        data: { matches: 0, filesScanned },
      };
    }
    const capped = matches.length >= limit ? `\n… (stopped at ${limit} matches)` : "";
    return {
      content: `${matches.length} match(es) for /${args.pattern}/:\n${matches.join("\n")}${capped}`,
      data: { matches: matches.length, filesScanned },
    };
  },
});

/* ------------------------------------------------------------------------- */

/** Convert a simple glob (only `*`) into an anchored RegExp. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i");
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

/** Convenience bundle for registry.registerAll(). */
export const builtinFsTools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirTool,
  grepTool,
] as unknown as Array<ToolDefinition<never>>;

/** Re-exported so callers can validate a path without running a tool. */
export { resolveInsideRoot };
