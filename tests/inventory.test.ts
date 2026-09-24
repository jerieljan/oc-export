import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parseArgs } from "../src/cli-args.js";

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateInventory = ajv.compile(
  JSON.parse(
    fs.readFileSync(
      path.resolve(import.meta.dir, "../schemas/inventory-extended.schema.json"),
      "utf8",
    ),
  ),
);

const cli = path.resolve(import.meta.dir, "../oc-export.ts");
const iso = (day: number) => `2026-09-${String(day).padStart(2, "0")}T00:00:00.000Z`;
function fixture(
  extractor: string,
  work: (
    root: string,
    storage: string,
    run: (...args: string[]) => ReturnType<typeof Bun.spawnSync>,
  ) => void,
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "oc-inventory-"));
  const storage = path.join(root, "storage");
  fs.mkdirSync(storage);
  const config = path.join(root, "config.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      extractor,
      picker: { limit: 1, databasePath: path.join(root, "db") },
      codex: { sessionsPath: storage, archivedPath: path.join(root, "archive") },
      claude: { projectsPath: storage },
      pi: { sessionsPath: storage },
    }),
  );
  const run = (...args: string[]) => {
    const result = Bun.spawnSync([process.execPath, cli, "ls", "--config", config, ...args]);
    if (args.includes("--json-extended")) {
      const body = JSON.parse(result.stdout.toString());
      if (!validateInventory(body)) throw new Error(JSON.stringify(validateInventory.errors));
    }
    return result;
  };
  try {
    work(root, storage, run);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
function jsonl(file: string, records: unknown[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
}

describe("programmatic inventory", () => {
  test("validates explicit retrieval and output modes", () => {
    for (const args of [
      ["--all"],
      ["--limit", "2"],
      ["--json-extended"],
      ["ls", "--all", "--limit=2"],
      ["ls", "--json", "--json-extended"],
      ["ls", "--all=true"],
      ["ls", "--limit=0"],
      ["ls", "--limit=-1"],
      ["ls", "--limit=1.2"],
      ["ls", "--limit=9007199254740992"],
    ]) {
      expect(parseArgs(args)).toHaveProperty("error");
    }
    expect(parseArgs(["ls", "--limit=30", "--json-extended"])).toHaveProperty("args.limit", 30);
  });

  for (const extractor of ["codex", "claude", "pi", "opencode", "opencode2"]) {
    test(`${extractor}: all and limits, event semantics, filtering and identity`, () =>
      fixture(extractor, (root, storage, run) => {
        if (extractor.startsWith("opencode")) {
          const db = new Database(path.join(root, "db"));
          const table = extractor === "opencode" ? "session" : "session_v2";
          db.run(
            `CREATE TABLE ${table} (id TEXT, title TEXT, directory TEXT, time_updated INTEGER, cost REAL, parent_id TEXT, fork_session_id TEXT, time_archived INTEGER)`,
          );
          for (let i = 1; i <= 25; i++)
            db.run(`INSERT INTO ${table} VALUES (?, ?, ?, ?, 0, ?, ?, NULL)`, [
              `s${i}`,
              `title${i}`,
              i === 1 ? "/other" : "/project",
              Date.parse(iso(i)),
              i === 25 ? "s1" : null,
              i === 25 ? "s2" : null,
            ]);
          db.close();
        } else
          for (let i = 1; i <= 25; i++) {
            const cwd = i === 1 ? "/other" : "/project";
            const records =
              extractor === "codex"
                ? [
                    {
                      type: "session_meta",
                      payload: { id: `s${i}`, cwd, parent_thread_id: i === 25 ? "s1" : undefined },
                    },
                    {
                      type: "response_item",
                      timestamp: iso(i),
                      payload: { type: "message", role: "user", content: [{ text: `title${i}` }] },
                    },
                    { type: "session_meta_update", timestamp: iso(28) },
                  ]
                : extractor === "pi"
                  ? [
                      { type: "session", id: `s${i}`, cwd },
                      {
                        type: "message",
                        timestamp: iso(i),
                        message: { role: "user", content: `title${i}` },
                      },
                    ]
                  : [
                      {
                        sessionId: `s${i}`,
                        type: "user",
                        cwd,
                        timestamp: iso(i),
                        message: { role: "user", content: `title${i}` },
                      },
                    ];
            jsonl(path.join(storage, "project", `s${i}.jsonl`), records);
          }
        const limited = JSON.parse(run("--json-extended").stdout.toString());
        expect(limited.coverage).toMatchObject({
          effective_limit: 1,
          truncated: true,
          scan_complete: true,
          matched_sessions: 25,
        });
        const all = run("--all", "--json-extended");
        expect(all.exitCode).toBe(0);
        const body = JSON.parse(all.stdout.toString());
        expect(body.sessions).toHaveLength(25);
        expect(body.coverage).toMatchObject({ effective_limit: null, truncated: false });
        expect(body.sessions[0]).toMatchObject({
          id: "s25",
          extractor,
          identity: `${extractor}:s25`,
          canonical_identity: null,
          last_activity_at: iso(25),
          activity_basis: extractor.startsWith("opencode") ? "database_update" : "session_event",
        });
        const filtered = JSON.parse(run("--json-extended", "--all", "/other").stdout.toString());
        expect(filtered.sessions.map((row: { id: string }) => row.id)).toEqual(["s1"]);
        expect(JSON.parse(run("--json", "--all").stdout.toString())).toHaveLength(25);
        expect(JSON.parse(run("--json", "--limit=3").stdout.toString())).toHaveLength(3);
        expect(
          JSON.parse(run("--json-extended", "--limit=3").stdout.toString()).sessions,
        ).toHaveLength(3);
      }));
  }

  test("Codex uses events instead of stale index or later file writes and reports malformed lines", () =>
    fixture("codex", (root, storage, run) => {
      const file = path.join(storage, "session.jsonl");
      jsonl(file, [
        { type: "session_meta", payload: { id: "id", cwd: "/oc-export" } },
        {
          type: "event_msg",
          timestamp: iso(20),
          payload: { type: "user_message", message: "hello" },
        },
        { type: "event_msg", timestamp: iso(18), payload: { type: "agent_message" } },
      ]);
      jsonl(path.join(root, "session_index.jsonl"), [
        { id: "id", thread_name: "indexed", updated_at: iso(1) },
      ]);
      fs.appendFileSync(file, "{bad\n");
      const result = run("--all", "--json-extended");
      expect(result.exitCode).toBe(1);
      const body = JSON.parse(result.stdout.toString());
      expect(body.sessions[0]).toMatchObject({
        title: "indexed",
        metadata_updated_at: iso(1),
        last_activity_at: iso(20),
        directory_basis: "session_metadata",
        archived: false,
      });
      expect(body.coverage).toMatchObject({
        status: "partial",
        scan_complete: false,
        truncated: false,
      });
      expect(body.warnings).toContainEqual(
        expect.objectContaining({ code: "malformed_record", line: 4 }),
      );
    }));

  test("empty, missing, unreadable and malformed storage are distinguishable", () =>
    fixture("pi", (_root, storage, run) => {
      let body = JSON.parse(run("--json-extended").stdout.toString());
      expect(body.coverage).toMatchObject({
        status: "complete",
        scan_complete: true,
        returned_sessions: 0,
      });
      jsonl(path.join(storage, "project", "bad.jsonl"), [{ type: "unknown" }]);
      body = JSON.parse(run("--json-extended").stdout.toString());
      expect(body.coverage.status).toBe("partial");
      fs.rmSync(storage, { recursive: true });
      body = JSON.parse(run("--json-extended").stdout.toString());
      expect(body.coverage.status).toBe("unavailable");
      expect(body.warnings[0].code).toBe("storage_missing");
      fs.writeFileSync(storage, "not a directory");
      body = JSON.parse(run("--json-extended").stdout.toString());
      expect(body.warnings[0].code).toBe("storage_unreadable");
    }));

  test("Pi never guesses a directory from a hyphenated folder and exposes parent path", () =>
    fixture("pi", (_root, storage, run) => {
      jsonl(path.join(storage, "--work-oc-export--", "session.jsonl"), [
        { type: "session", id: "id", parentSession: "/parent.jsonl" },
      ]);
      const body = JSON.parse(run("--json-extended").stdout.toString());
      expect(body.sessions[0]).toMatchObject({
        directory: null,
        directory_basis: null,
        activity_basis: "file_mtime",
        parent_session_path: "/parent.jsonl",
      });
      expect(
        JSON.parse(run("--json-extended", "/work/oc/export").stdout.toString()).sessions,
      ).toEqual([]);
    }));

  test("Claude includes subagents and retains stale indexed sessions with a warning", () =>
    fixture("claude", (_root, storage, run) => {
      jsonl(path.join(storage, "project", "parent.jsonl"), [
        { type: "user", sessionId: "parent", timestamp: iso(1) },
      ]);
      jsonl(path.join(storage, "project", "parent", "subagents", "agent-a.jsonl"), [
        { type: "assistant", sessionId: "parent", timestamp: iso(2) },
      ]);
      fs.writeFileSync(
        path.join(storage, "project", "sessions-index.json"),
        JSON.stringify({
          entries: [{ sessionId: "stale", modified: iso(3), projectPath: "/index" }],
        }),
      );
      const result = run("--all", "--json-extended");
      expect(result.exitCode).toBe(1);
      const body = JSON.parse(result.stdout.toString());
      expect(body.sessions).toHaveLength(3);
      expect(body.sessions).toContainEqual(
        expect.objectContaining({
          parent_id: "parent",
          is_subagent: true,
          last_activity_at: iso(2),
        }),
      );
      expect(body.sessions).toContainEqual(
        expect.objectContaining({
          id: "stale",
          activity_basis: "index_update",
          directory_basis: "index",
        }),
      );
    }));
});

test("Codex merges archive copies and reads event timestamps beyond picker title scan limits", () =>
  fixture("codex", (root, storage, run) => {
    const header = { type: "session_meta", payload: { id: "id", forked_from_id: "origin" } };
    jsonl(path.join(storage, "session.jsonl"), [
      header,
      { type: "event_msg", timestamp: iso(1), payload: { type: "user_message" } },
    ]);
    jsonl(path.join(root, "archive", "session.jsonl"), [
      header,
      ...Array.from({ length: 250 }, () => ({ type: "metadata", timestamp: iso(28) })),
      { type: "event_msg", timestamp: iso(20), payload: { type: "agent_message" } },
    ]);
    const result = run("--all", "--json-extended");
    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout.toString());
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]).toMatchObject({
      last_activity_at: iso(20),
      archived: null,
      fork_session_id: "origin",
      directory: null,
    });
    expect(body.warnings).toContainEqual(
      expect.objectContaining({ code: "duplicate_session", affects_completeness: false }),
    );
  }));

test("database unknown timestamps stay null and sort after known activity", () =>
  fixture("opencode", (root, _storage, run) => {
    const db = new Database(path.join(root, "db"));
    db.run("CREATE TABLE session (id TEXT, title TEXT, directory TEXT, time_updated INTEGER)");
    db.run(
      "INSERT INTO session VALUES ('unknown', NULL, NULL, NULL), ('epoch', 'Known', '/project', 0)",
    );
    db.close();
    const result = run("--all", "--json-extended");
    expect(result.exitCode).toBe(0);
    const body = JSON.parse(result.stdout.toString());
    expect(body.sessions.map((row: { id: string }) => row.id)).toEqual(["epoch", "unknown"]);
    expect(body.sessions[1]).toMatchObject({
      metadata_updated_at: null,
      last_activity_at: null,
      activity_basis: null,
      directory: null,
      archived: null,
    });
  }));

for (const extractor of ["codex", "claude", "pi"]) {
  test(`${extractor}: separates messages from tool-only activity and ignores metadata updates`, () =>
    fixture(extractor, (_root, storage, run) => {
      const records =
        extractor === "codex"
          ? [
              { type: "session_meta", payload: { id: "id", cwd: "/recorded" } },
              {
                type: "response_item",
                timestamp: iso(1),
                payload: { type: "message", role: "user", content: [{ text: "Hello" }] },
              },
              {
                type: "response_item",
                timestamp: iso(3),
                payload: { type: "function_call_output" },
              },
            ]
          : extractor === "claude"
            ? [
                {
                  type: "user",
                  sessionId: "id",
                  cwd: "/recorded",
                  timestamp: iso(1),
                  message: { content: "Hello" },
                },
                {
                  type: "assistant",
                  sessionId: "id",
                  cwd: "/later",
                  timestamp: iso(2),
                  message: { content: [{ type: "tool_use" }] },
                },
                {
                  type: "user",
                  sessionId: "id",
                  timestamp: iso(3),
                  message: { content: [{ type: "tool_result" }] },
                },
              ]
            : [
                { type: "session", id: "id", cwd: "/recorded" },
                { type: "message", timestamp: iso(1), message: { role: "user", content: "Hello" } },
                {
                  type: "message",
                  timestamp: iso(2),
                  message: { role: "assistant", content: [{ type: "toolCall" }] },
                },
                {
                  type: "message",
                  timestamp: iso(3),
                  message: { role: "toolResult", content: [{ type: "text", text: "output" }] },
                },
              ];
      jsonl(path.join(storage, "project", "id.jsonl"), [
        ...records,
        { type: "metadata", timestamp: iso(28) },
      ]);
      const result = run("--json-extended");
      expect(result.exitCode).toBe(0);
      const row = JSON.parse(result.stdout.toString()).sessions[0];
      expect(row).toMatchObject({
        last_message_at: iso(1),
        last_tool_event_at: iso(3),
        last_activity_at: iso(3),
        activity_basis: "session_event",
        title_basis: "first_user_message",
        directory: "/recorded",
        directory_semantics: extractor === "claude" ? "first_observed_cwd" : "initial_cwd",
      });
    }));
}

test("Codex scope identifies configuration, stays stable across scans and records scan boundaries", () =>
  fixture("codex", (root, storage, run) => {
    const first = JSON.parse(run("--json-extended").stdout.toString()).scope;
    const second = JSON.parse(
      run("--json-extended", "--all", "/some-filter").stdout.toString(),
    ).scope;
    expect(first.store_id).toBe(second.store_id);
    expect(first.store_id).toMatch(/^codex:[0-9a-f]{64}$/);
    expect(first.roots).toContainEqual({
      role: "sessions",
      path: storage,
      normalized_path: fs.realpathSync(storage),
    });
    expect(first.archive_policy).toBe("include_archive_root");
    expect(Date.parse(first.started_at)).toBeLessThanOrEqual(Date.parse(first.finished_at));
    const configFile = path.join(root, "config.json");
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    config.codex.archivedPath = path.join(root, "different-archive");
    fs.writeFileSync(configFile, JSON.stringify(config));
    const third = JSON.parse(run("--json-extended").stdout.toString()).scope;
    expect(third.store_id).not.toBe(first.store_id);
  }));

test("unsupported Codex layout has a distinct warning linked to its known session", () =>
  fixture("codex", (_root, storage, run) => {
    jsonl(path.join(storage, "old.jsonl"), [
      { id: "old", timestamp: iso(1), instructions: "historical layout" },
      { type: "message", role: "user" },
    ]);
    const good = path.join(storage, "good.jsonl");
    jsonl(good, [{ type: "session_meta", payload: { id: "good" } }]);
    fs.appendFileSync(good, "{bad\n");
    const result = run("--all", "--json-extended");
    expect(result.exitCode).toBe(1);
    const body = JSON.parse(result.stdout.toString());
    expect(body.warnings).toContainEqual(
      expect.objectContaining({
        code: "unsupported_format",
        session_id: "old",
        session_identity: "codex:old",
      }),
    );
    expect(body.warnings).toContainEqual(
      expect.objectContaining({
        code: "malformed_record",
        session_id: "good",
        session_identity: "codex:good",
        line: 2,
      }),
    );
    expect(body.sessions[0]).toMatchObject({
      id: "good",
      last_message_at: null,
      last_tool_event_at: null,
      activity_basis: "file_mtime",
    });
  }));

test("missing Claude UUID transcript retains index metadata and has one linked warning", () =>
  fixture("claude", (_root, storage, run) => {
    const id = "11111111-1111-4111-8111-111111111111";
    const fullPath = path.join(storage, "project", `${id}.jsonl`);
    fs.mkdirSync(path.dirname(fullPath));
    fs.writeFileSync(
      path.join(path.dirname(fullPath), "sessions-index.json"),
      JSON.stringify({
        entries: [
          {
            sessionId: id,
            fullPath,
            modified: iso(2),
            projectPath: "/project",
            firstPrompt: "Hello",
          },
        ],
      }),
    );
    const result = run("--json-extended");
    expect(result.exitCode).toBe(1);
    const body = JSON.parse(result.stdout.toString());
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatchObject({
      code: "storage_missing",
      session_id: id,
      session_identity: `claude:${id}`,
    });
    expect(body.sessions[0]).toMatchObject({
      title: "Hello",
      title_basis: "index",
      directory_semantics: "project_path",
      last_message_at: null,
      last_tool_event_at: null,
      last_activity_at: iso(2),
      activity_basis: "index_update",
    });
  }));

for (const extractor of ["codex", "claude"]) {
  test(`${extractor}: skips injected fallback titles`, () =>
    fixture(extractor, (_root, storage, run) => {
      const texts =
        extractor === "codex"
          ? ["<environment_context>ambient context</environment_context>", "Actual request"]
          : ["<local-command-caveat>local output</local-command-caveat>", "Actual request"];
      const records =
        extractor === "codex"
          ? [
              { type: "session_meta", payload: { id: "id" } },
              ...texts.map((text) => ({
                type: "response_item",
                timestamp: iso(1),
                payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
              })),
            ]
          : texts.map((text) => ({
              type: "user",
              sessionId: "id",
              timestamp: iso(1),
              message: { content: text },
            }));
      jsonl(path.join(storage, "project", "id.jsonl"), records);
      const row = JSON.parse(run("--json-extended").stdout.toString()).sessions[0];
      expect(row).toMatchObject({ title: "Actual request", title_basis: "first_user_message" });
    }));
}

test("duplicate merging preserves events over newer file copies and exposes conflicts", () =>
  fixture("codex", (root, storage, run) => {
    jsonl(path.join(storage, "events.jsonl"), [
      { type: "session_meta", payload: { id: "id", cwd: "/first", parent_thread_id: "one" } },
      {
        type: "event_msg",
        timestamp: iso(10),
        payload: { type: "user_message", message: "Original" },
      },
    ]);
    const copied = path.join(root, "archive", "copied.jsonl");
    jsonl(copied, [
      { type: "session_meta", payload: { id: "id", cwd: "/second", parent_thread_id: "two" } },
    ]);
    fs.utimesSync(copied, Date.parse(iso(28)) / 1000, Date.parse(iso(28)) / 1000);
    jsonl(path.join(storage, "tools.jsonl"), [
      { type: "session_meta", payload: { id: "id", cwd: "/first" } },
      { type: "response_item", timestamp: iso(12), payload: { type: "function_call_output" } },
    ]);
    const result = run("--all", "--json-extended");
    expect(result.exitCode).toBe(1);
    const body = JSON.parse(result.stdout.toString());
    const row = body.sessions[0];
    expect(row).toMatchObject({
      last_message_at: iso(10),
      last_tool_event_at: iso(12),
      last_observed_activity_at: iso(12),
      last_activity_at: iso(12),
      activity_basis: "session_event",
      extraction_status: "partial",
      directory: null,
      directory_basis: null,
      parent_id: null,
      parent_ref: null,
      archived: null,
    });
    expect(row.copies).toHaveLength(3);
    expect(row.copies).toContainEqual(
      expect.objectContaining({
        path: copied,
        extraction_status: "metadata_only",
        last_observed_activity_at: null,
        last_activity_at: iso(28),
        archived: true,
      }),
    );
    expect(row.copies).toContainEqual(
      expect.objectContaining({ last_message_at: iso(10), directory: "/first" }),
    );
    expect(
      body.warnings.filter((warning: { code: string }) => warning.code === "conflicting_copies"),
    ).toHaveLength(2);
  }));

for (const invalid of [null, "not-a-date", false, "2026-99-99", 1e30]) {
  test(`invalid activity timestamp ${String(invalid)} marks extraction partial`, () =>
    fixture("codex", (_root, storage, run) => {
      jsonl(path.join(storage, "id.jsonl"), [
        { type: "session_meta", payload: { id: "id" } },
        { type: "event_msg", timestamp: iso(1), payload: { type: "user_message" } },
        { type: "response_item", timestamp: invalid, payload: { type: "function_call" } },
      ]);
      const result = run("--json-extended");
      expect(result.exitCode).toBe(1);
      const body = JSON.parse(result.stdout.toString());
      expect(body.coverage.scan_complete).toBe(false);
      expect(body.sessions[0]).toMatchObject({
        extraction_status: "partial",
        last_observed_activity_at: iso(1),
        last_tool_event_at: null,
      });
      expect(body.sessions[0].copies[0].extraction_status).toBe("partial");
      expect(body.warnings).toContainEqual(
        expect.objectContaining({
          code: "invalid_activity_timestamp",
          line: 3,
          session_identity: "codex:id",
        }),
      );
    }));
}

test("references resolve before limits; Claude children export through their parent", () =>
  fixture("claude", (_root, storage, run) => {
    jsonl(path.join(storage, "project", "parent.jsonl"), [
      { type: "user", sessionId: "parent", timestamp: iso(1) },
    ]);
    jsonl(path.join(storage, "project", "parent", "subagents", "agent-a.jsonl"), [
      { type: "assistant", sessionId: "parent", timestamp: iso(2) },
    ]);
    const body = JSON.parse(run("--json-extended", "--limit=1").stdout.toString());
    expect(body.sessions[0]).toMatchObject({
      id: "parent/agent-a",
      export_session_id: "parent",
      parent_ref: {
        id: "parent",
        identity: "claude:parent",
        resolved: true,
        store_id: body.scope.store_id,
      },
    });
    fs.rmSync(path.join(storage, "project", "parent.jsonl"));
    const orphan = JSON.parse(run("--json-extended").stdout.toString()).sessions[0];
    expect(orphan).toMatchObject({
      export_session_id: null,
      parent_ref: { id: "parent", resolved: false },
    });
  }));

test("Pi parent paths resolve to scoped references", () =>
  fixture("pi", (_root, storage, run) => {
    const parentFile = path.join(storage, "project", "parent.jsonl");
    jsonl(parentFile, [{ type: "session", id: "parent" }]);
    jsonl(path.join(storage, "project", "child.jsonl"), [
      { type: "session", id: "child", parentSession: parentFile },
    ]);
    const body = JSON.parse(run("--json-extended", "--all").stdout.toString());
    expect(body.sessions.find((row: { id: string }) => row.id === "child")).toMatchObject({
      parent_ref: { identity: "pi:parent", resolved: true },
      extraction_status: "metadata_only",
      last_observed_activity_at: null,
    });
  }));

test("schema rejects invalid contracts and accepts additive fields", () =>
  fixture("pi", (_root, storage, run) => {
    jsonl(path.join(storage, "project", "id.jsonl"), [{ type: "session", id: "id" }]);
    const body = JSON.parse(run("--json-extended").stdout.toString());
    expect(validateInventory({ ...body, future_field: true })).toBe(true);
    for (const mutate of [
      (value: typeof body) => {
        value.schema_version = 3;
      },
      (value: typeof body) => {
        delete value.coverage;
      },
      (value: typeof body) => {
        value.sessions[0].extraction_status = "unrecognized";
      },
      (value: typeof body) => {
        value.sessions[0].last_observed_activity_at = 42;
      },
      (value: typeof body) => {
        value.sessions[0].copies = [];
      },
      (value: typeof body) => {
        value.sessions[0].parent_ref = { id: "parent" };
      },
      (value: typeof body) => {
        value.warnings = [{ code: "oops" }];
      },
    ]) {
      const invalid = structuredClone(body);
      mutate(invalid);
      expect(validateInventory(invalid)).toBe(false);
    }
  }));
