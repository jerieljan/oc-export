import fs from "node:fs";
import { openDatabase } from "../db.js";
import { spawnToFile } from "../util.js";
import type { SessionRow, Source, SourceOptions } from "./types.js";

/**
 * Definition for sources backed by an OpenCode SQLite database. The V1 and V2
 * databases share the same session-row shape and differ only in table name,
 * how child sessions are matched, and the CLI command that exports a session.
 */
export interface SqliteSourceDefinition {
  /** Source name used for --extractor selection. */
  name: string;
  label: string;
  /** Table holding session rows (e.g. "session" or "session_v2"). */
  table: string;
  /** SQL condition (without WHERE) matching child sessions of $parentId. */
  childWhere: string;
  /** Command whose stdout is the JSON export of one session. */
  exportCommand: (id: string) => string[];
  /** Normalize rows before returning them (e.g. defaulting empty titles). */
  normalizeRow?: (row: SessionRow) => SessionRow;
}

const SESSION_COLUMNS = "id, title, directory, time_updated, cost";

export function createSqliteSessionSource(definition: SqliteSourceDefinition): Source {
  const { table, childWhere, exportCommand, normalizeRow = (row) => row } = definition;

  function getDatabasePath(options: SourceOptions): string {
    return options.config.picker.databasePath;
  }

  async function queryRows(
    sql: string,
    params: Record<string, unknown>,
    options: SourceOptions,
  ): Promise<SessionRow[]> {
    const dbPath = getDatabasePath(options);
    if (!fs.existsSync(dbPath)) {
      throw new Error(`Opencode database not found: ${dbPath}`);
    }

    const db = await openDatabase(dbPath);
    try {
      return (db.prepare(sql).all(params) as SessionRow[]).map(normalizeRow);
    } finally {
      db.close();
    }
  }

  async function listSessions(options: SourceOptions): Promise<SessionRow[]> {
    return queryRows(
      `SELECT ${SESSION_COLUMNS}
       FROM ${table}
       ORDER BY time_updated DESC
       LIMIT $limit`,
      { $limit: options.config.picker.limit },
      options,
    );
  }

  async function findChildSessions(
    parentId: string,
    options: SourceOptions,
  ): Promise<SessionRow[]> {
    return queryRows(
      `SELECT ${SESSION_COLUMNS}
       FROM ${table}
       WHERE ${childWhere}
       ORDER BY time_created ASC`,
      { $parentId: parentId },
      options,
    );
  }

  async function findSessionById(idOrSuffix: string, options: SourceOptions): Promise<SessionRow> {
    const exact = await queryRows(
      `SELECT ${SESSION_COLUMNS}
       FROM ${table}
       WHERE id = $id`,
      { $id: idOrSuffix },
      options,
    );
    if (exact.length > 0) return exact[0]!;

    const matches = await queryRows(
      `SELECT ${SESSION_COLUMNS}
       FROM ${table}
       WHERE substr(id, -8) = $suffix`,
      { $suffix: idOrSuffix },
      options,
    );

    if (matches.length === 1) return matches[0]!;

    if (matches.length > 1) {
      throw new Error(`Ambiguous suffix "${idOrSuffix}" matches ${matches.length} sessions.`);
    }

    throw new Error(`Session not found: ${idOrSuffix}`);
  }

  async function exportSessionToFile(id: string, outputPath: string): Promise<string> {
    await spawnToFile(exportCommand(id), outputPath);
    return outputPath;
  }

  return {
    name: definition.name,
    label: definition.label,
    listSessions,
    findSessionById,
    findChildSessions,
    exportSessionToFile,
  };
}
