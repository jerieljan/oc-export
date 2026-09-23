import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "../src/cli-args.js";
import { formatSessionList } from "../src/list.js";

const cli = path.resolve(import.meta.dir, "../oc-export.ts");

describe("ls", () => {
  test("parses directory and source with flags before or after the command", () => {
    for (const argv of [
      ["ls", "--extractor", "codex", "."],
      ["--extractor=codex", "ls", "."],
    ]) {
      expect(parseArgs(argv)).toEqual({
        help: false,
        args: { command: "ls", extractor: "codex", directory: ".", files: [] },
      });
    }
    expect(parseArgs(["./ls"])).toEqual({ help: false, args: { files: ["./ls"] } });
    expect(parseArgs(["ls", "--help"])).toEqual({ help: true });
  });

  test("rejects extra paths and export-only flags", () => {
    for (const argv of [
      ["ls", ".", ".."],
      ["ls", "--session=a"],
      ["ls", "--output=x"],
      ["ls", "--raw"],
      ["ls", "--no-raw"],
      ["ls", "--summarize"],
    ]) {
      expect(parseArgs(argv)).toHaveProperty("error");
    }
  });

  test("keeps metadata on one line and shows full IDs", () => {
    expect(
      formatSessionList([
        {
          id: "full-session-id",
          title: "Hello\nworld\t\x1b",
          directory: "/project",
          time_updated: 0,
        },
      ]),
    ).toBe(
      "ID\tUPDATED (UTC)\tDIRECTORY\tTITLE\nfull-session-id\t1970-01-01T00:00:00.000Z\t/project\tHello world  ",
    );
  });

  for (const extractor of ["codex", "claude", "pi", "opencode", "opencode2"]) {
    test(`${extractor}: CLI filters before limiting, respects config, and never prompts or exports`, () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc-list-"));
      try {
        const target = path.join(root, "project");
        const alias = path.join(root, "alias");
        fs.mkdirSync(target);
        fs.symlinkSync(target, alias);
        const storage = path.join(root, "storage");
        fs.mkdirSync(storage);
        const records = [
          { id: "old-match", directory: target, time_updated: 1000 },
          { id: "new-match", directory: target, time_updated: 2000 },
          { id: "child", directory: `${target}/child`, time_updated: 3000 },
          { id: "sibling", directory: `${target}-other`, time_updated: 4000 },
          { id: "unknown", directory: "", time_updated: 5000 },
        ];
        const dbPath = path.join(root, "sessions.db");
        if (extractor.startsWith("opencode")) {
          const db = new Database(dbPath);
          const table = extractor === "opencode2" ? "session_v2" : "session";
          db.run(
            `CREATE TABLE ${table} (id TEXT, title TEXT, directory TEXT, time_updated INTEGER, cost REAL)`,
          );
          for (const row of records)
            db.run(`INSERT INTO ${table} VALUES (?, ?, ?, ?, 0)`, [
              row.id,
              row.id,
              row.directory,
              row.time_updated,
            ]);
          db.close();
        } else if (extractor === "claude") {
          const project = path.join(storage, "project");
          fs.mkdirSync(project);
          fs.writeFileSync(
            path.join(project, "sessions-index.json"),
            JSON.stringify({
              entries: records.map((row) => ({
                sessionId: row.id,
                projectPath: row.directory,
                firstPrompt: row.id,
                fileMtime: row.time_updated,
              })),
            }),
          );
        } else {
          const folder = path.join(storage, "project");
          fs.mkdirSync(folder);
          for (const row of records) {
            const file = path.join(folder, `${row.id}.jsonl`);
            const header =
              extractor === "codex"
                ? { type: "session_meta", payload: { id: row.id, cwd: row.directory } }
                : { type: "session", id: row.id, cwd: row.directory };
            fs.writeFileSync(file, `${JSON.stringify(header)}\n`);
            fs.utimesSync(file, row.time_updated / 1000, row.time_updated / 1000);
          }
        }
        const config = path.join(root, "config.json");
        fs.writeFileSync(
          config,
          JSON.stringify({
            extractor,
            picker: { databasePath: dbPath, limit: 1 },
            codex: { sessionsPath: storage, archivedPath: path.join(root, "archive") },
            claude: { projectsPath: storage },
            pi: { sessionsPath: storage },
            summarize: { enabled: true, always: true },
          }),
        );
        const run = (...args: string[]) =>
          Bun.spawnSync([process.execPath, cli, "ls", "--config", config, ...args], {
            cwd: target,
            stdin: "ignore",
          });
        const unfiltered = run();
        expect(unfiltered.exitCode).toBe(0);
        expect(unfiltered.stdout.toString()).toContain("unknown");
        for (const directory of [".", `${target}/`, alias]) {
          const result = run("--extractor", extractor, directory);
          expect(result.exitCode).toBe(0);
          const output = result.stdout.toString();
          expect(output).toContain("new-match");
          expect(output).not.toContain("old-match");
          expect(output).not.toContain("sibling");
          expect(output).not.toContain("child");
          expect(output).not.toContain("unknown");
        }
        const empty = run(path.join(root, "missing"));
        expect(empty.exitCode).toBe(0);
        expect(empty.stdout.toString().trim()).toBe("No sessions found.");
        expect(fs.readdirSync(target)).toEqual([]);
        const invalid = run("--extractor", "bogus");
        expect(invalid.exitCode).toBe(1);
        expect(invalid.stderr.toString()).toContain("Unknown extractor/source");
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
