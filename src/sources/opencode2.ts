import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "../db.js";
import { spawnToFile } from "../util.js";
import type { SessionRow, Source, SourceOptions } from "./types.js";

function _last8(id: string): string {
  return id.slice(-8);
}

export function getDatabasePath(options: SourceOptions): string {
  return options.config.picker.databasePath;
}

function normalizeRow(row: SessionRow): SessionRow {
  return {
    ...row,
    title: row.title || "Untitled session",
  };
}

export async function listSessions(options: SourceOptions): Promise<SessionRow[]> {
  const dbPath = getDatabasePath(options);
  const limit = options.config.picker.limit;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Opencode database not found: ${dbPath}`);
  }

  const db = await openDatabase(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT id, title, directory, time_updated, cost
         FROM session_v2
         ORDER BY time_updated DESC
         LIMIT $limit`,
      )
      .all({ $limit: limit }) as SessionRow[];
    return rows.map(normalizeRow);
  } finally {
    db.close();
  }
}

export async function findChildSessions(
  parentId: string,
  options: SourceOptions,
): Promise<SessionRow[]> {
  const dbPath = getDatabasePath(options);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Opencode database not found: ${dbPath}`);
  }

  const db = await openDatabase(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT id, title, directory, time_updated, cost
         FROM session_v2
         WHERE parent_id = $parentId OR fork_session_id = $parentId
         ORDER BY time_created ASC`,
      )
      .all({ $parentId: parentId }) as SessionRow[];
    return rows.map(normalizeRow);
  } finally {
    db.close();
  }
}

export async function findSessionById(
  idOrSuffix: string,
  options: SourceOptions,
): Promise<SessionRow> {
  const dbPath = getDatabasePath(options);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Opencode database not found: ${dbPath}`);
  }

  const db = await openDatabase(dbPath);
  try {
    const exact = db
      .prepare(
        `SELECT id, title, directory, time_updated, cost
         FROM session_v2
         WHERE id = $id`,
      )
      .get({ $id: idOrSuffix }) as SessionRow | null;
    if (exact) {
      return normalizeRow(exact);
    }

    const matches = db
      .prepare(
        `SELECT id, title, directory, time_updated, cost
         FROM session_v2
         WHERE substr(id, -8) = $suffix`,
      )
      .all({ $suffix: idOrSuffix }) as SessionRow[];

    if (matches.length === 1) {
      return normalizeRow(matches[0]!);
    }

    if (matches.length > 1) {
      throw new Error(`Ambiguous suffix "${idOrSuffix}" matches ${matches.length} sessions.`);
    }

    throw new Error(`Session not found: ${idOrSuffix}`);
  } finally {
    db.close();
  }
}

export async function exportSessionToFile(id: string, outputPath: string): Promise<string> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await spawnToFile(["opencode2", "export", "-s", id], outputPath);
  return outputPath;
}

export const opencode2Source: Source = {
  name: "opencode2",
  label: "Opencode2",
  listSessions,
  findSessionById,
  findChildSessions,
  exportSessionToFile: (id, outputPath) => exportSessionToFile(id, outputPath),
};
