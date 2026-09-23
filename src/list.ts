import type { ResolvedConfig } from "./config.js";
import { getSource } from "./sources/index.js";
import type { SessionRow } from "./sources/types.js";

export function formatSessionList(rows: SessionRow[]): string {
  if (rows.length === 0) return "No sessions found.";
  // Keep each record on one line, including titles containing terminal controls.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Strip control characters from terminal output.
  const cell = (value: string): string => value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ");
  return [
    "ID\tUPDATED (UTC)\tDIRECTORY\tTITLE",
    ...rows.map((row) =>
      [row.id, new Date(row.time_updated).toISOString(), row.directory, row.title]
        .map(cell)
        .join("\t"),
    ),
  ].join("\n");
}

export async function listSessions(config: ResolvedConfig, directory?: string): Promise<void> {
  const source = getSource(config.extractor);
  const rows = await source.listSessions({ config, directory });
  console.log(formatSessionList(rows));
}
