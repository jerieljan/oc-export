import path from "node:path";
import readline from "node:readline/promises";
import { DEFAULT_CONFIG, type ResolvedConfig } from "./config.js";
import { renderFile } from "./render.js";
import { sanitizePathForDisplay } from "./sanitize.js";
import { getSource, type Source } from "./sources/index.js";
import type { SessionRow } from "./sources/types.js";
import type { SummarizeOptions } from "./summarize.js";

export interface PickOptions {
  sanitize?: boolean;
  outputBase?: string;
  config?: ResolvedConfig;
  summarize?: SummarizeOptions;
}

function last8(id: string): string {
  return id.slice(-8);
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function truncateDir(dir: string, max = 40): string {
  if (dir.length <= max) return dir;
  return `...${dir.slice(-(max - 3))}`;
}

function getSourceFromConfig(config: ResolvedConfig): Source {
  return getSource(config.extractor);
}

function resolveSessionOutputPaths(
  id: string,
  outputBase?: string,
): { jsonPath: string; htmlPath: string } {
  const suffix = last8(id);
  if (outputBase) {
    const resolved = path.resolve(outputBase);
    const dir = path.dirname(resolved);
    const base = path.basename(resolved, path.extname(resolved));
    return {
      jsonPath: path.join(dir, `${base}.jsonl`),
      htmlPath: path.join(dir, `${base}.html`),
    };
  }
  return {
    jsonPath: path.resolve(`session-${suffix}.jsonl`),
    htmlPath: path.resolve(`session-${suffix}.html`),
  };
}

interface ExportContext {
  parentHtmlPath?: string;
  parentTitle?: string;
}

async function exportAndRenderSingleSession(
  id: string,
  options: PickOptions,
  source: Source,
  jsonPath: string,
  htmlPath: string,
  parentContext: ExportContext = {},
  totalCost?: number,
): Promise<string> {
  const { sanitize = true, config = DEFAULT_CONFIG, summarize } = options;

  const displayJson = sanitize ? sanitizePathForDisplay(jsonPath) : path.basename(jsonPath);
  const displayHtml = sanitize ? sanitizePathForDisplay(htmlPath) : path.basename(htmlPath);

  console.log(`Exporting session ${id} via ${source.label} → ${displayJson}`);
  await source.exportSessionToFile(id, jsonPath, { config });

  const parentOutputPath = parentContext.parentHtmlPath
    ? `./${path.basename(parentContext.parentHtmlPath)}`
    : undefined;

  console.log(`Rendering → ${displayHtml}`);
  await renderFile(jsonPath, {
    sanitize,
    outputPath: htmlPath,
    summarize,
    username: config.username,
    navigation: config.navigation,
    parentOutputPath,
    parentTitle: parentContext.parentTitle,
    totalCost,
  });

  console.log(`Done: ${displayJson} → ${displayHtml}`);
  return htmlPath;
}

export async function exportAndRenderSession(id: string, options: PickOptions = {}): Promise<void> {
  const { config = DEFAULT_CONFIG } = options;
  const source = getSourceFromConfig(config);
  const { jsonPath, htmlPath } = resolveSessionOutputPaths(id, options.outputBase);

  const parentRow = await source.findSessionById(id, { config });
  const parentCost = parentRow.cost ?? 0;

  let totalCost = parentCost;
  let children: SessionRow[] = [];
  if (source.findChildSessions) {
    children = await source.findChildSessions(id, { config });
    for (const child of children) {
      totalCost += child.cost ?? 0;
    }
  }

  const parentTotalCost = totalCost > parentCost ? totalCost : undefined;
  const parentHtmlPath = await exportAndRenderSingleSession(
    id,
    options,
    source,
    jsonPath,
    htmlPath,
    {},
    parentTotalCost,
  );

  if (children.length === 0) {
    return;
  }

  const parentDir = path.dirname(htmlPath);

  console.log(`Exporting ${children.length} subagent session(s)...`);
  for (const child of children) {
    const suffix = last8(child.id);
    const childJsonPath = path.join(parentDir, `session-${suffix}.jsonl`);
    const childHtmlPath = path.join(parentDir, `session-${suffix}.html`);
    await exportAndRenderSingleSession(child.id, options, source, childJsonPath, childHtmlPath, {
      parentHtmlPath,
      parentTitle: parentRow.title,
    });
  }
}

export async function pickInteractive(options: PickOptions = {}): Promise<void> {
  const { sanitize = true, config = DEFAULT_CONFIG } = options;
  const source = getSourceFromConfig(config);
  const rows = await source.listSessions({ config });

  if (rows.length === 0) {
    throw new Error("No sessions found.");
  }

  console.log(`\nNewest ${source.label} sessions:\n`);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const idx = String(i + 1).padStart(2, " ");
    const date = formatDate(row.time_updated);
    const dir = sanitize ? sanitizePathForDisplay(row.directory) : truncateDir(row.directory);
    console.log(`${idx}. [${last8(row.id)}] ${row.title}`);
    console.log(`    ${date} · ${dir}`);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question("\nPick a session (number): ");
  rl.close();

  const num = parseInt(answer.trim(), 10);
  if (Number.isNaN(num) || num < 1 || num > rows.length) {
    throw new Error("Invalid selection.");
  }

  await exportAndRenderSession(rows[num - 1]!.id, options);
}

export async function pickSessionById(
  idOrSuffix: string,
  options: PickOptions = {},
): Promise<void> {
  const { config = DEFAULT_CONFIG } = options;
  const source = getSourceFromConfig(config);
  const row = await source.findSessionById(idOrSuffix, { config });
  await exportAndRenderSession(row.id, options);
}
