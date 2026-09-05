import fs from "node:fs";
import path from "node:path";
import type { SessionRow, Source, SourceOptions } from "./types.js";

// Reads OpenAI Codex rollout files directly from ~/.codex/sessions and
// ~/.codex/archived_sessions. Titles come from ~/.codex/session_index.jsonl
// (a rolling index, so older sessions fall back to their first user prompt).

interface CodexSessionEntry {
  sessionId: string;
  filePath: string;
  fileMtimeMs: number;
  cwd: string;
  parentThreadId?: string;
  // Resolved lazily; used when the session index has no title for the file.
  firstPrompt?: string;
}

interface CodexIndexEntry {
  id: string;
  thread_name?: string;
  updated_at?: string;
}

function getSessionsPath(options: SourceOptions): string {
  return options.config.codex.sessionsPath;
}

function getArchivedPath(options: SourceOptions): string {
  return options.config.codex.archivedPath;
}

function getLimit(options: SourceOptions): number {
  return options.config.codex.limit;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}

/** Read the first line of a file without loading it entirely. */
function readFirstLine(filePath: string, maxBytes = 1048576): string {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(maxBytes);
    let read = 0;
    while (read < maxBytes) {
      const bytes = fs.readSync(fd, buffer, read, maxBytes - read, read);
      if (bytes <= 0) break;
      read += bytes;
    }
    const text = buffer.toString("utf-8", 0, read);
    const newline = text.indexOf("\n");
    return newline === -1 ? text : text.slice(0, newline);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close errors
      }
    }
  }
}

interface RolloutMetaPayload {
  session_id?: string;
  id?: string;
  timestamp?: string;
  cwd?: string;
  parent_thread_id?: string;
}

/** Parse the session_meta first line. Returns null for unsupported files. */
function parseRolloutMeta(filePath: string): CodexSessionEntry | null {
  try {
    const parsed = JSON.parse(readFirstLine(filePath)) as {
      type?: string;
      payload?: RolloutMetaPayload;
    };
    if (parsed.type !== "session_meta" || typeof parsed.payload !== "object") return null;
    const payload = parsed.payload ?? {};
    // `id` is the rollout's own thread id. Subagent rollouts reuse the
    // parent's id for `session_id`, so `id` is the reliable identity.
    const sessionId =
      typeof payload.id === "string" && payload.id
        ? payload.id
        : typeof payload.session_id === "string"
          ? payload.session_id
          : undefined;
    if (!sessionId) return null;
    return {
      sessionId,
      filePath,
      fileMtimeMs: fs.statSync(filePath).mtimeMs,
      cwd: typeof payload.cwd === "string" ? payload.cwd : "",
      parentThreadId:
        typeof payload.parent_thread_id === "string" ? payload.parent_thread_id : undefined,
    };
  } catch {
    return null;
  }
}

function listJsonlFiles(root: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(root)) return files;

  const visit = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
  };

  visit(root);
  return files;
}

function readSessionIndex(indexPath: string): Map<string, CodexIndexEntry> {
  const index = new Map<string, CodexIndexEntry>();
  try {
    const text = fs.readFileSync(indexPath, "utf-8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as CodexIndexEntry;
        if (typeof parsed?.id === "string") {
          // Later lines win; the index is rewritten with the newest titles.
          index.set(parsed.id, parsed);
        }
      } catch {
        // Skip malformed lines.
      }
    }
  } catch {
    // A missing index is fine; titles fall back to first prompts.
  }
  return index;
}

/**
 * Codex injects ambient context as user-role messages that always start with
 * a tag such as <environment_context>; real prompts never do. Good enough
 * for title fallback without parsing the whole file.
 */
function isInjectedPrompt(text: string): boolean {
  return text.trimStart().startsWith("<");
}

function extractFirstPrompt(filePath: string, maxBytes = 524288): string {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      let read = 0;
      while (read < maxBytes) {
        const bytes = fs.readSync(fd, buffer, read, maxBytes - read, read);
        if (bytes <= 0) break;
        read += bytes;
      }
      const text = buffer.toString("utf-8", 0, read);
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const record = JSON.parse(trimmed) as {
            type?: string;
            payload?: { type?: string; role?: string; content?: unknown };
          };
          if (record.type !== "response_item" || record.payload?.type !== "message") continue;
          if (record.payload.role !== "user") continue;
          const content = record.payload.content;
          if (!Array.isArray(content)) continue;
          const prompt = content
            .map((part) =>
              typeof part === "object" && part !== null && (part as { text?: unknown }).text
                ? String((part as { text: unknown }).text)
                : "",
            )
            .join("\n")
            .trim();
          if (prompt && !isInjectedPrompt(prompt)) {
            return prompt.replace(/\s+/g, " ").trim();
          }
        } catch {}
      }
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    // Fall through to the empty prompt.
  }
  return "";
}

interface ScanResult {
  entries: CodexSessionEntry[];
  titles: Map<string, CodexIndexEntry>;
}

// Scanning reads the first line of every rollout, so cache the last result
// per process. The CLI is short-lived; the picker, --session lookups, child
// lookups and exports all need the entries and would otherwise rescan.
let scanCache: { sessionsPath: string; archivedPath: string; result: ScanResult } | null = null;

function scanSessions(options: SourceOptions): ScanResult {
  const sessionsPath = getSessionsPath(options);
  const archivedPath = getArchivedPath(options);
  if (scanCache?.sessionsPath === sessionsPath && scanCache?.archivedPath === archivedPath) {
    return scanCache.result;
  }

  const byId = new Map<string, CodexSessionEntry>();
  for (const filePath of [...listJsonlFiles(sessionsPath), ...listJsonlFiles(archivedPath)]) {
    const entry = parseRolloutMeta(filePath);
    if (!entry) continue;
    const existing = byId.get(entry.sessionId);
    // The same session can exist in sessions/ and archived_sessions/; keep
    // the most recently written copy.
    if (!existing || existing.fileMtimeMs < entry.fileMtimeMs) {
      byId.set(entry.sessionId, entry);
    }
  }

  // The index lives in the Codex home directory (~/.codex), which is the
  // parent of both default paths.
  const titles = readSessionIndex(path.join(path.dirname(sessionsPath), "session_index.jsonl"));

  const result: ScanResult = { entries: [...byId.values()], titles };
  scanCache = { sessionsPath, archivedPath, result };
  return result;
}

function entryToRow(entry: CodexSessionEntry, titles: Map<string, CodexIndexEntry>): SessionRow {
  const indexEntry = titles.get(entry.sessionId);
  let title = indexEntry?.thread_name?.trim() ?? "";
  if (!title) {
    if (entry.firstPrompt === undefined) {
      entry.firstPrompt = extractFirstPrompt(entry.filePath);
    }
    title = truncate(entry.firstPrompt, 120);
  }
  const updatedAt = indexEntry?.updated_at ? Date.parse(indexEntry.updated_at) : NaN;
  return {
    id: entry.sessionId,
    title: title || "Codex session",
    directory: entry.cwd,
    time_updated: Number.isNaN(updatedAt) ? entry.fileMtimeMs : updatedAt,
  };
}

function findEntry(entries: CodexSessionEntry[], idOrSuffix: string): CodexSessionEntry {
  const exact = entries.find((entry) => entry.sessionId === idOrSuffix);
  if (exact) return exact;

  const matches = entries.filter((entry) => entry.sessionId.endsWith(idOrSuffix));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1) {
    throw new Error(`Ambiguous suffix "${idOrSuffix}" matches ${matches.length} Codex sessions.`);
  }
  throw new Error(`Codex session not found: ${idOrSuffix}`);
}

export function listSessions(options: SourceOptions): SessionRow[] {
  const limit = getLimit(options);
  const { entries, titles } = scanSessions(options);
  const rows = entries.map((entry) => entryToRow(entry, titles));
  rows.sort((a, b) => b.time_updated - a.time_updated);
  return rows.slice(0, limit);
}

export function findSessionById(idOrSuffix: string, options: SourceOptions): SessionRow {
  const { entries, titles } = scanSessions(options);
  return entryToRow(findEntry(entries, idOrSuffix), titles);
}

export function findChildSessions(parentId: string, options: SourceOptions): SessionRow[] {
  const { entries, titles } = scanSessions(options);
  return entries
    .filter((entry) => entry.parentThreadId === parentId)
    .map((entry) => entryToRow(entry, titles))
    .sort((a, b) => a.time_updated - b.time_updated);
}

export async function exportSessionToFile(
  id: string,
  outputPath: string,
  options: SourceOptions,
): Promise<string> {
  const { entries, titles } = scanSessions(options);
  const entry = findEntry(entries, id);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const indexEntry = titles.get(entry.sessionId);
  const title = indexEntry?.thread_name?.trim() || "";
  if (!title) {
    // Nothing to enrich; copy the rollout verbatim.
    fs.copyFileSync(entry.filePath, outputPath);
    return outputPath;
  }

  // Inject the indexed title into the session_meta payload so the extractor
  // sees the real thread name instead of falling back to a first prompt.
  const text = fs.readFileSync(entry.filePath, "utf-8");
  const newline = text.indexOf("\n");
  const firstLine = newline === -1 ? text : text.slice(0, newline);
  const rest = newline === -1 ? "" : text.slice(newline + 1);
  let outputText: string;
  try {
    const parsed = JSON.parse(firstLine) as {
      type?: string;
      payload?: Record<string, unknown>;
    };
    if (parsed.type === "session_meta" && typeof parsed.payload === "object") {
      parsed.payload.thread_name = title;
      outputText = `${JSON.stringify(parsed)}\n${rest}`;
    } else {
      outputText = text;
    }
  } catch {
    outputText = text;
  }
  fs.writeFileSync(outputPath, outputText, "utf-8");
  return outputPath;
}

export const codexSource: Source = {
  name: "codex",
  label: "OpenAI Codex",
  listSessions,
  findSessionById,
  findChildSessions,
  exportSessionToFile,
};
