import path from "node:path";
import fs from "node:fs";
import readline from "node:readline/promises";
import { DEFAULT_CONFIG, type ResolvedConfig } from "./config.ts";
import { sanitizePathForDisplay } from "./sanitize.ts";
import { renderFile } from "./render.ts";
import { getSource, type Source } from "./sources/index.ts";
import type { SummarizeOptions } from "./summarize.ts";

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
  return "..." + dir.slice(-(max - 3));
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

export async function exportAndRenderSession(
  id: string,
  options: PickOptions = {},
): Promise<void> {
  const { sanitize = true, config = DEFAULT_CONFIG, summarize } = options;
  const source = getSourceFromConfig(config);
  const { jsonPath, htmlPath } = resolveSessionOutputPaths(id, options.outputBase);

  const displayJson = sanitize ? sanitizePathForDisplay(jsonPath) : path.basename(jsonPath);
  const displayHtml = sanitize ? sanitizePathForDisplay(htmlPath) : path.basename(htmlPath);

  console.log(`Exporting session ${id} via ${source.label} → ${displayJson}`);
  await source.exportSessionToFile(id, jsonPath, { config });

  console.log(`Rendering → ${displayHtml}`);
  await renderFile(jsonPath, {
    sanitize,
    outputPath: htmlPath,
    summarize,
    username: config.username,
  });

  console.log(`Done: ${displayJson} → ${displayHtml}`);
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
