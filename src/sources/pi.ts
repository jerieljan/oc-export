import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHome } from "../util.js";
import type { SessionRow, Source, SourceOptions } from "./types.js";

const DEFAULT_SESSIONS_PATH = path.join(os.homedir(), ".pi/agent/sessions");

interface PiSessionFile {
  filePath: string;
  sessionId: string;
  title: string;
  directory: string;
  time_updated: number;
}

function getSessionsPath(options: SourceOptions): string {
  return expandHome(options.config.pi?.sessionsPath ?? DEFAULT_SESSIONS_PATH);
}

function getLimit(options: SourceOptions): number {
  return options.config.pi?.limit ?? options.config.picker.limit;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function normalizeDirectoryName(dirName: string): string {
  // Pi directories are encoded as --<cwd-with-dashes>--
  return dirName.replace(/^--/, "").replace(/--$/, "").replace(/-/g, "/");
}

function extractUuidFromFileName(fileName: string): string | undefined {
  const base = path.basename(fileName, ".jsonl");
  const match = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return match?.[1];
}

function readSessionInfo(filePath: string): PiSessionFile | null {
  try {
    const stat = fs.statSync(filePath);
    const text = fs.readFileSync(filePath, "utf-8");
    const lines = text.split("\n");

    let header: Record<string, unknown> | undefined;
    let title: string | undefined;
    let cwd: string | undefined;
    let sessionId: string | undefined;

    for (let i = 0; i < Math.min(lines.length, 200); i++) {
      const line = lines[i]?.trim();
      if (!line) continue;
      try {
        const obj = JSON.parse(line) as Record<string, unknown>;
        if (obj.type === "session" && !header) {
          header = obj;
          if (typeof obj.id === "string") sessionId = obj.id;
          if (typeof obj.cwd === "string") cwd = obj.cwd;
        }
        if (obj.type === "session_info" && typeof obj.name === "string" && !title) {
          title = obj.name;
        }
        if (
          obj.type === "message" &&
          typeof obj.message === "object" &&
          obj.message !== null &&
          (obj.message as Record<string, unknown>).role === "user" &&
          !title
        ) {
          const content = (obj.message as Record<string, unknown>).content;
          let prompt = "";
          if (typeof content === "string") {
            prompt = content;
          } else if (Array.isArray(content)) {
            prompt = content
              .filter(
                (c): c is Record<string, unknown> =>
                  typeof c === "object" && c !== null && c.type === "text",
              )
              .map((c) => String(c.text || ""))
              .join(" ");
          }
          prompt = prompt.replace(/\s+/g, " ").trim();
          if (prompt) title = prompt;
        }
      } catch {
        continue;
      }
      if (title && header) break;
    }

    if (!sessionId) {
      sessionId = extractUuidFromFileName(path.basename(filePath));
    }

    if (!sessionId) return null;

    if (!cwd) {
      cwd = normalizeDirectoryName(path.basename(path.dirname(filePath)));
    }

    return {
      filePath,
      sessionId,
      title: title ? truncate(title, 120) : "Pi session",
      directory: cwd,
      time_updated: stat.mtimeMs,
    };
  } catch {
    return null;
  }
}

function scanSessions(sessionsPath: string): PiSessionFile[] {
  if (!fs.existsSync(sessionsPath)) return [];
  const result: PiSessionFile[] = [];

  for (const dirEntry of fs.readdirSync(sessionsPath, {
    withFileTypes: true,
  })) {
    if (!dirEntry.isDirectory()) continue;
    const projectDir = path.join(sessionsPath, dirEntry.name);
    for (const file of fs.readdirSync(projectDir)) {
      if (!file.endsWith(".jsonl")) continue;
      const filePath = path.join(projectDir, file);
      const info = readSessionInfo(filePath);
      if (info) result.push(info);
    }
  }

  return result;
}

function mapToRow(info: PiSessionFile): SessionRow {
  return {
    id: info.sessionId,
    title: info.title,
    directory: info.directory,
    time_updated: info.time_updated,
  };
}

export function listSessions(options: SourceOptions): SessionRow[] {
  const sessionsPath = getSessionsPath(options);
  const limit = getLimit(options);

  if (!fs.existsSync(sessionsPath)) {
    throw new Error(`Pi sessions directory not found: ${sessionsPath}`);
  }

  const files = scanSessions(sessionsPath);
  files.sort((a, b) => b.time_updated - a.time_updated);
  return files.slice(0, limit).map(mapToRow);
}

export function findSessionById(idOrSuffix: string, options: SourceOptions): SessionRow {
  const sessionsPath = getSessionsPath(options);

  if (!fs.existsSync(sessionsPath)) {
    throw new Error(`Pi sessions directory not found: ${sessionsPath}`);
  }

  const files = scanSessions(sessionsPath);
  const exact = files.find((f) => f.sessionId === idOrSuffix);
  if (exact) return mapToRow(exact);

  const matches = files.filter((f) => f.sessionId.endsWith(idOrSuffix));
  if (matches.length === 1) return mapToRow(matches[0]!);

  if (matches.length > 1) {
    throw new Error(`Ambiguous suffix "${idOrSuffix}" matches ${matches.length} Pi sessions.`);
  }

  throw new Error(`Pi session not found: ${idOrSuffix}`);
}

export async function exportSessionToFile(
  id: string,
  outputPath: string,
  options: SourceOptions,
): Promise<string> {
  const sessionsPath = getSessionsPath(options);

  if (!fs.existsSync(sessionsPath)) {
    throw new Error(`Pi sessions directory not found: ${sessionsPath}`);
  }

  const files = scanSessions(sessionsPath);
  const file = files.find((f) => f.sessionId === id);
  if (!file) {
    throw new Error(`Pi session file not found: ${id}`);
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.copyFileSync(file.filePath, outputPath);
  return outputPath;
}

export const piSource: Source = {
  name: "pi",
  label: "Pi",
  listSessions,
  findSessionById,
  exportSessionToFile,
};
