import { Database } from "bun:sqlite";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import readline from "node:readline/promises";
import { sanitizePathForDisplay } from "./sanitize.ts";
import { renderFile } from "./render.ts";

const DB_PATH = path.join(os.homedir(), ".local/share/opencode/opencode.db");
const LIMIT = 20;

export interface PickOptions {
  sanitize?: boolean;
  outputBase?: string;
}

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  time_updated: number;
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

async function runExportToFile(id: string, jsonPath: string): Promise<void> {
  const dir = path.dirname(jsonPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const proc = Bun.spawn({
    cmd: ["opencode", "export", id],
    stdout: Bun.file(jsonPath),
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`opencode export failed (exit ${exitCode}):\n${stderr}`);
  }
}

async function findSessionByIdOrSuffix(idOrSuffix: string): Promise<SessionRow> {
  const db = new Database(DB_PATH, { readonly: true, create: false });

  const exact = db
    .query(
      `SELECT id, title, directory, time_updated
       FROM session
       WHERE id = $id`,
    )
    .get({ $id: idOrSuffix }) as SessionRow | null;
  if (exact) {
    db.close();
    return exact;
  }

  const matches = db
    .query(
      `SELECT id, title, directory, time_updated
       FROM session
       WHERE substr(id, -8) = $suffix`,
    )
    .all({ $suffix: idOrSuffix }) as SessionRow[];
  db.close();

  if (matches.length === 1) {
    return matches[0]!;
  }

  if (matches.length > 1) {
    console.error(
      `Ambiguous suffix "${idOrSuffix}" matches ${matches.length} sessions:`,
    );
    for (const m of matches) {
      console.error(`  ${m.id} (${m.title})`);
    }
    throw new Error("Session lookup failed");
  }

  throw new Error(`Session not found: ${idOrSuffix}`);
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
      jsonPath: path.join(dir, `${base}.json`),
      htmlPath: path.join(dir, `${base}.html`),
    };
  }
  return {
    jsonPath: path.resolve(`session-${suffix}.json`),
    htmlPath: path.resolve(`session-${suffix}.html`),
  };
}

export async function exportAndRenderSession(
  id: string,
  options: PickOptions = {},
): Promise<void> {
  const { sanitize = true } = options;
  const { jsonPath, htmlPath } = resolveSessionOutputPaths(id, options.outputBase);

  const displayJson = sanitize ? sanitizePathForDisplay(jsonPath) : path.basename(jsonPath);
  const displayHtml = sanitize ? sanitizePathForDisplay(htmlPath) : path.basename(htmlPath);

  console.log(`Exporting session ${id} → ${displayJson}`);
  await runExportToFile(id, jsonPath);

  console.log(`Rendering → ${displayHtml}`);
  await renderFile(jsonPath, { sanitize, outputPath: htmlPath });

  console.log(`Done: ${displayJson} → ${displayHtml}`);
}

export async function pickInteractive(options: PickOptions = {}): Promise<void> {
  const { sanitize = true } = options;
  const db = new Database(DB_PATH, { readonly: true, create: false });
  const rows = db
    .query(
      `SELECT id, title, directory, time_updated
       FROM session
       ORDER BY time_updated DESC
       LIMIT $limit`,
    )
    .all({ $limit: LIMIT }) as SessionRow[];
  db.close();

  if (rows.length === 0) {
    throw new Error("No sessions found.");
  }

  console.log(`\nNewest sessions (limit ${LIMIT}):\n`);
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
  const row = await findSessionByIdOrSuffix(idOrSuffix);
  await exportAndRenderSession(row.id, options);
}
