import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SessionRow, Source, SourceOptions } from "./types.js";

const DEFAULT_PROJECTS_PATH = path.join(os.homedir(), ".claude/projects");

interface ClaudeSessionIndexEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt: string;
  messageCount: number;
  created: string;
  modified: string;
  gitBranch: string;
  projectPath: string;
  isSidechain: boolean;
}

interface ClaudeSessionIndex {
  version: number;
  entries: ClaudeSessionIndexEntry[];
  originalPath?: string;
}

interface ClaudeMessage {
  type?: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  promptId?: string;
  agentId?: string;
  isSidechain?: boolean;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
    id?: string;
    type?: string;
  };
  attachment?: {
    type?: string;
    filename?: string;
    content?: unknown;
    displayPath?: string;
  };
  subtype?: string;
  aiTitle?: string;
  [key: string]: unknown;
}

function expandHome(inputPath: string): string {
  if (inputPath.startsWith("~/") || inputPath === "~") {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}

function isMetaPrompt(content: string): boolean {
  const metaTags = [
    "<local-command-caveat>",
    "<local-command-stdout>",
    "<command-name>",
    "<command-message>",
    "<command-args>",
  ];
  return metaTags.some((tag) => content.includes(tag));
}

function normalizePrompt(text: string): string {
  const unescaped = text
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
  const collapsed = unescaped.replace(/\s+/g, " ").trim();
  return collapsed.length > 120 ? `${collapsed.slice(0, 117)}...` : collapsed;
}

function getProjectsPath(options: SourceOptions): string {
  const configured = options.config.claude?.projectsPath;
  return expandHome(configured ?? DEFAULT_PROJECTS_PATH);
}

function getLimit(options: SourceOptions): number {
  return options.config.claude?.limit ?? options.config.picker.limit;
}

function findSessionIndices(projectsPath: string): string[] {
  if (!fs.existsSync(projectsPath)) return [];
  const indices: string[] = [];
  for (const entry of fs.readdirSync(projectsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const indexPath = path.join(projectsPath, entry.name, "sessions-index.json");
    if (fs.existsSync(indexPath)) {
      indices.push(indexPath);
    }
  }
  return indices;
}

function readSessionIndex(indexPath: string): ClaudeSessionIndex | null {
  try {
    const text = fs.readFileSync(indexPath, "utf-8");
    const parsed = JSON.parse(text) as ClaudeSessionIndex;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.entries)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function entryToRow(entry: ClaudeSessionIndexEntry): SessionRow {
  return {
    id: entry.sessionId,
    title: entry.firstPrompt ? normalizePrompt(entry.firstPrompt) : "Claude Code session",
    directory: entry.projectPath || "",
    time_updated: entry.modified ? Date.parse(entry.modified) : entry.fileMtime,
  };
}

export function listSessions(options: SourceOptions): SessionRow[] {
  const projectsPath = getProjectsPath(options);
  const limit = getLimit(options);

  if (!fs.existsSync(projectsPath)) {
    throw new Error(`Claude Code projects directory not found: ${projectsPath}`);
  }

  const entries = listSessionEntries(projectsPath);
  const rows = entries.map(entryToRow);
  rows.sort((a, b) => b.time_updated - a.time_updated);
  return rows.slice(0, limit);
}

export function findSessionById(idOrSuffix: string, options: SourceOptions): SessionRow {
  const projectsPath = getProjectsPath(options);

  if (!fs.existsSync(projectsPath)) {
    throw new Error(`Claude Code projects directory not found: ${projectsPath}`);
  }

  const entries = listSessionEntries(projectsPath);

  const exact = entries.find((e) => e.sessionId === idOrSuffix);
  if (exact) return entryToRow(exact);

  const matches = entries.filter((e) => e.sessionId.endsWith(idOrSuffix));
  if (matches.length === 1) return entryToRow(matches[0]!);

  if (matches.length > 1) {
    throw new Error(`Ambiguous suffix "${idOrSuffix}" matches ${matches.length} Claude sessions.`);
  }

  throw new Error(`Claude session not found: ${idOrSuffix}`);
}

function readJsonl(filePath: string): ClaudeMessage[] {
  const text = fs.readFileSync(filePath, "utf-8");
  const messages: ClaudeMessage[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as ClaudeMessage);
    } catch {
      // Skip malformed lines.
    }
  }
  return messages;
}

function inferSessionFromJsonl(filePath: string): ClaudeSessionIndexEntry | null {
  try {
    const messages = readJsonl(filePath);
    let sessionId: string | undefined;
    let firstPrompt = "";
    let created = "";
    let modified = "";
    let projectPath = "";
    let gitBranch = "";
    const fileMtime = fs.statSync(filePath).mtimeMs;

    for (const message of messages) {
      if (message.sessionId && !sessionId) sessionId = message.sessionId;
      if (typeof message.cwd === "string" && !projectPath) projectPath = message.cwd;
      if (typeof message.gitBranch === "string" && !gitBranch) {
        gitBranch = message.gitBranch;
      }
      if (message.timestamp) {
        if (!created) created = message.timestamp;
        modified = message.timestamp;
      }
      if (
        message.type === "user" &&
        !firstPrompt &&
        typeof message.message?.content === "string" &&
        !isMetaPrompt(message.message.content) &&
        message.message.content.trim().length > 0
      ) {
        firstPrompt = message.message.content;
      }
    }

    if (!sessionId) {
      const base = path.basename(filePath, ".jsonl");
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)) {
        sessionId = base;
      }
    }

    if (!sessionId) return null;

    return {
      sessionId,
      fullPath: filePath,
      fileMtime,
      firstPrompt: normalizePrompt(firstPrompt),
      messageCount: messages.length,
      created,
      modified,
      gitBranch,
      projectPath,
      isSidechain: false,
    };
  } catch {
    return null;
  }
}

function listSessionEntries(projectsPath: string): ClaudeSessionIndexEntry[] {
  const entries: ClaudeSessionIndexEntry[] = [];
  const seen = new Set<string>();

  // Prefer sessions-index.json files.
  for (const indexPath of findSessionIndices(projectsPath)) {
    const index = readSessionIndex(indexPath);
    if (!index) continue;
    for (const entry of index.entries) {
      if (!seen.has(entry.sessionId)) {
        seen.add(entry.sessionId);
        entries.push(entry);
      }
    }
  }

  // Fallback: scan for .jsonl session files directly.
  for (const entry of fs.readdirSync(projectsPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const projectDir = path.join(projectsPath, entry.name);
    for (const file of fs.readdirSync(projectDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(projectDir, file);
      const inferred = inferSessionFromJsonl(filePath);
      if (inferred && !seen.has(inferred.sessionId)) {
        seen.add(inferred.sessionId);
        entries.push(inferred);
      }
    }
  }

  return entries;
}

function findSessionFile(sessionId: string, projectsPath: string): string | null {
  const entries = listSessionEntries(projectsPath);
  const entry = entries.find((e) => e.sessionId === sessionId);
  if (entry && fs.existsSync(entry.fullPath)) {
    return entry.fullPath;
  }

  // Fallback: search filesystem for <sessionId>.jsonl.
  for (const dirEntry of fs.readdirSync(projectsPath, {
    withFileTypes: true,
  })) {
    if (!dirEntry.isDirectory()) continue;
    const candidate = path.join(projectsPath, dirEntry.name, `${sessionId}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function resolvePersistedOutput(content: unknown, _toolResultsDir: string): unknown {
  if (typeof content !== "string") return content;

  const match = content.match(/<persisted-output>\s*Full output saved to:\s*(\S+)\s*Preview/i);
  if (!match) return content;

  const filePath = match[1];
  if (!filePath || !fs.existsSync(filePath)) return content;

  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return content;
  }
}

function inlineSubagents(messages: ClaudeMessage[], subagentsDir: string): ClaudeMessage[] {
  if (!fs.existsSync(subagentsDir)) return messages;

  const subagentFiles = fs.readdirSync(subagentsDir).filter((name) => name.endsWith(".jsonl"));

  const subagentMap = new Map<string, ClaudeMessage[]>();
  for (const file of subagentFiles) {
    const base = path.basename(file, ".jsonl");
    const agentId = base.replace(/^agent-/, "");
    const filePath = path.join(subagentsDir, file);
    subagentMap.set(agentId, readJsonl(filePath));
  }

  return messages.map((message) => {
    const toolUseResult = message.toolUseResult as
      | { agentId?: string; agentType?: string; prompt?: string }
      | undefined;
    const agentId = toolUseResult?.agentId;
    if (!agentId) return message;

    const subagentMessages = subagentMap.get(agentId);
    if (!subagentMessages) return message;

    const content = message.message?.content;
    if (!Array.isArray(content)) return message;

    const newContent = content.map((item: unknown) => {
      if (
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).type === "tool_result"
      ) {
        return {
          ...item,
          __oc_inlined_subagent: true,
          __oc_subagent_messages: subagentMessages,
        };
      }
      return item;
    });

    return {
      ...message,
      message: {
        ...message.message,
        content: newContent,
      },
    };
  });
}

function readPersistedOutput(
  toolUseResult: Record<string, unknown> | undefined,
  toolResultsDir: string,
): string | undefined {
  if (!toolUseResult) return undefined;

  const stdout = toolUseResult.stdout;
  if (typeof stdout === "string" && stdout.length > 0) {
    return stdout;
  }

  const persistedPath =
    typeof toolUseResult.persistedOutputPath === "string"
      ? toolUseResult.persistedOutputPath
      : undefined;
  if (persistedPath && fs.existsSync(persistedPath)) {
    try {
      return fs.readFileSync(persistedPath, "utf-8");
    } catch {
      return undefined;
    }
  }

  // Fallback: try resolving from a <persisted-output> placeholder in content.
  const content = toolUseResult.content;
  if (typeof content === "string") {
    const resolved = resolvePersistedOutput(content, toolResultsDir);
    if (resolved !== content && typeof resolved === "string") return resolved;
  }

  return undefined;
}

function resolvePersistedOutputs(
  messages: ClaudeMessage[],
  toolResultsDir: string,
): ClaudeMessage[] {
  return messages.map((message) => {
    const content = message.message?.content;

    if (typeof content === "string") {
      return {
        ...message,
        message: {
          ...message.message,
          content: resolvePersistedOutput(content, toolResultsDir),
        },
      };
    }

    if (!Array.isArray(content)) return message;

    const toolUseResult = message.toolUseResult as Record<string, unknown> | undefined;
    const persistedOutput = readPersistedOutput(toolUseResult, toolResultsDir);

    const newContent = content.map((item: unknown) => {
      if (
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).type === "tool_result"
      ) {
        const toolResult = item as Record<string, unknown>;

        // If the message has a resolved persisted output, replace the
        // placeholder content with the real output.
        if (persistedOutput !== undefined) {
          return { ...toolResult, content: persistedOutput };
        }

        const originalContent = toolResult.content;
        if (typeof originalContent === "string") {
          return {
            ...toolResult,
            content: resolvePersistedOutput(originalContent, toolResultsDir),
          };
        }
        if (Array.isArray(originalContent)) {
          return {
            ...toolResult,
            content: originalContent.map((part: unknown) => {
              if (
                typeof part === "object" &&
                part !== null &&
                typeof (part as Record<string, unknown>).text === "string"
              ) {
                return {
                  ...part,
                  text: resolvePersistedOutput(
                    (part as Record<string, unknown>).text,
                    toolResultsDir,
                  ),
                };
              }
              return part;
            }),
          };
        }
      }
      return item;
    });

    return {
      ...message,
      message: {
        ...message.message,
        content: newContent,
      },
    };
  });
}

export async function exportSessionToFile(
  id: string,
  outputPath: string,
  options: SourceOptions,
): Promise<string> {
  const projectsPath = getProjectsPath(options);
  const sessionFile = findSessionFile(id, projectsPath);
  if (!sessionFile) {
    throw new Error(`Claude session file not found: ${id}`);
  }

  const sessionDir = path.dirname(sessionFile);
  const sessionBase = path.basename(sessionFile, ".jsonl");
  const subagentsDir = path.join(sessionDir, sessionBase, "subagents");
  const toolResultsDir = path.join(sessionDir, sessionBase, "tool-results");

  let messages = readJsonl(sessionFile);
  messages = resolvePersistedOutputs(messages, toolResultsDir);
  messages = inlineSubagents(messages, subagentsDir);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const lines = messages.map((m) => JSON.stringify(m));
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf-8");
  return outputPath;
}

export const claudeSource: Source = {
  name: "claude",
  label: "Claude Code",
  listSessions,
  findSessionById,
  exportSessionToFile,
};
