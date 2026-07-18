#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";

const DB_PATH = path.join(os.homedir(), ".local/share/opencode/opencode.db");
const LIMIT = 20;

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

async function runRender(jsonPath: string): Promise<void> {
  const proc = Bun.spawn({
    cmd: ["bun", "render.ts", jsonPath],
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`render.ts failed (exit ${exitCode})`);
  }
}

async function pickInteractive(): Promise<void> {
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
    console.error("No sessions found.");
    process.exit(1);
  }

  console.log(`\nNewest sessions (limit ${LIMIT}):\n`);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const idx = String(i + 1).padStart(2, " ");
    const date = formatDate(row.time_updated);
    const dir = truncateDir(row.directory);
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
    console.error("Invalid selection.");
    process.exit(1);
  }

  await exportAndRender(rows[num - 1]!.id);
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
    process.exit(1);
  }

  console.error(`Session not found: ${idOrSuffix}`);
  process.exit(1);
}

async function exportAndRender(id: string): Promise<void> {
  const suffix = last8(id);
  const jsonName = `session-${suffix}.json`;
  const jsonPath = path.resolve(jsonName);
  const htmlName = `session-${suffix}.html`;

  console.log(`Exporting session ${id} → ${jsonName}`);
  await runExportToFile(id, jsonPath);

  console.log(`Rendering → ${htmlName}`);
  await runRender(jsonPath);

  console.log(`Done: ${jsonPath} → ${htmlName}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    await pickInteractive();
  } else {
    const row = await findSessionByIdOrSuffix(args[0]!);
    await exportAndRender(row.id);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
