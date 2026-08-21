import type { ResolvedConfig } from "../config.js";

// A row returned by any session source for the interactive picker and
// --session lookups.
export interface SessionRow {
  id: string;
  title: string;
  directory: string;
  time_updated: number;
  cost?: number;
}

// Options passed to source methods.
export interface SourceOptions {
  config: ResolvedConfig;
}

// A session source abstracts where oc-export reads sessions from.
// The default source is the local Opencode SQLite database; additional
// sources can read other tools' local storage (e.g. Claude Code).
export interface Source {
  name: string;
  label: string;

  // List recent sessions for the interactive picker.
  listSessions(options: SourceOptions): Promise<SessionRow[]> | SessionRow[];

  // Find a session by full ID or a unique last-N suffix.
  findSessionById(idOrSuffix: string, options: SourceOptions): Promise<SessionRow> | SessionRow;

  // Find sessions that were spawned as subagents of a parent session.
  // Optional; sources that do not store parent/child relationships may omit it.
  findChildSessions?(
    parentId: string,
    options: SourceOptions,
  ): Promise<SessionRow[]> | SessionRow[];

  // Export a session to a file on disk and return the written path.
  // The caller is responsible for rendering the exported file.
  exportSessionToFile(id: string, outputPath: string, options: SourceOptions): Promise<string>;
}
