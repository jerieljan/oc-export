import { Database } from "bun:sqlite";
import path from "node:path";
import fs from "node:fs";
import Bun from "bun";
import type { SessionRow, Source, SourceOptions } from "./types.ts";

function last8(id: string): string {
  return id.slice(-8);
}

export function getDatabasePath(options: SourceOptions): string {
  return options.config.picker.databasePath;
}

export function listSessions(options: SourceOptions): SessionRow[] {
  const dbPath = getDatabasePath(options);
  const limit = options.config.picker.limit;

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Opencode database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true, create: false });
  try {
    const rows = db
      .query(
        `SELECT id, title, directory, time_updated
         FROM session
         ORDER BY time_updated DESC
         LIMIT $limit`,
      )
      .all({ $limit: limit }) as SessionRow[];
    return rows;
  } finally {
    db.close();
  }
}

export function findSessionById(
  idOrSuffix: string,
  options: SourceOptions,
): SessionRow {
  const dbPath = getDatabasePath(options);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Opencode database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true, create: false });
  try {
    const exact = db
      .query(
        `SELECT id, title, directory, time_updated
         FROM session
         WHERE id = $id`,
      )
      .get({ $id: idOrSuffix }) as SessionRow | null;
    if (exact) return exact;

    const matches = db
      .query(
        `SELECT id, title, directory, time_updated
         FROM session
         WHERE substr(id, -8) = $suffix`,
      )
      .all({ $suffix: idOrSuffix }) as SessionRow[];

    if (matches.length === 1) return matches[0]!;

    if (matches.length > 1) {
      throw new Error(
        `Ambiguous suffix "${idOrSuffix}" matches ${matches.length} sessions.`,
      );
    }

    throw new Error(`Session not found: ${idOrSuffix}`);
  } finally {
    db.close();
  }
}

export async function exportSessionToFile(
  id: string,
  outputPath: string,
): Promise<string> {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const proc = Bun.spawn({
    cmd: ["opencode", "export", id],
    stdout: Bun.file(outputPath),
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`opencode export failed (exit ${exitCode}):\n${stderr}`);
  }
  return outputPath;
}

export const opencodeSource: Source = {
  name: "opencode",
  label: "Opencode",
  listSessions,
  findSessionById,
  exportSessionToFile: (id, outputPath) => exportSessionToFile(id, outputPath),
};
