import type { ResolvedConfig } from "./config.js";
import { getSource } from "./sources/index.js";
import { scanSessionInventory } from "./sources/inventory.js";
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

export async function listSessions(
  config: ResolvedConfig,
  directory?: string,
  json = false,
  options: { all?: boolean; limit?: number; jsonExtended?: boolean } = {},
): Promise<void> {
  const source = getSource(config.extractor);
  if (options.jsonExtended) {
    const result = await scanSessionInventory(config, directory, options);
    console.log(JSON.stringify(result));
    if (!result.coverage.scan_complete) process.exitCode = 1;
    return;
  }
  const limit = options.all ? Number.MAX_SAFE_INTEGER : options.limit;
  const effectiveConfig =
    limit === undefined
      ? config
      : {
          ...config,
          picker: { ...config.picker, limit },
          codex: { ...config.codex, limit },
          claude: { ...config.claude, limit },
          pi: { ...config.pi, limit },
        };
  const rows = await source.listSessions({ config: effectiveConfig, directory });
  console.log(json ? JSON.stringify(rows) : formatSessionList(rows));
}
