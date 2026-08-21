import { createSqliteSessionSource } from "./sqlite.js";
import type { SessionRow, Source } from "./types.js";

function normalizeRow(row: SessionRow): SessionRow {
  return {
    ...row,
    title: row.title || "Untitled session",
  };
}

export const opencode2Source: Source = createSqliteSessionSource({
  name: "opencode2",
  label: "Opencode2",
  table: "session_v2",
  // V2 also links forked sessions to their origin via fork_session_id.
  childWhere: "parent_id = $parentId OR fork_session_id = $parentId",
  // Newer opencode2 builds take the session ID as a positional argument
  // (the old -s flag was removed).
  exportCommand: (id) => ["opencode2", "export", id],
  normalizeRow,
});
