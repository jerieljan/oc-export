import { createSqliteSessionSource } from "./sqlite.js";
import type { Source } from "./types.js";

export const opencodeSource: Source = createSqliteSessionSource({
  name: "opencode",
  label: "Opencode",
  table: "session",
  childWhere: "parent_id = $parentId",
  exportCommand: (id) => ["opencode", "export", id],
});
