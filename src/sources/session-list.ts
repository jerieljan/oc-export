import fs from "node:fs";
import path from "node:path";
import type { SessionRow } from "./types.js";

function normalizeDirectory(directory: string): string {
  const absolute = path.resolve(directory);
  try {
    return fs.realpathSync(absolute);
  } catch {
    // Sessions can refer to directories that have since been removed.
    return absolute;
  }
}

/** Match the working directory itself, not descendants or similarly named paths. */
export function selectRecentSessions(
  rows: SessionRow[],
  limit: number,
  directory?: string,
): SessionRow[] {
  const target = directory === undefined ? undefined : normalizeDirectory(directory);
  return rows
    .filter(
      (row) =>
        target === undefined ||
        (row.directory !== "" && normalizeDirectory(row.directory) === target),
    )
    .sort((a, b) => b.time_updated - a.time_updated)
    .slice(0, limit);
}
