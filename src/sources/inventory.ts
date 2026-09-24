import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type { ResolvedConfig } from "../config.js";
import { openDatabase } from "../db.js";
import { isMetaPrompt } from "./claude.js";
import { isInjectedPrompt } from "./codex.js";
import { normalizeDirectory } from "./session-list.js";

export interface SessionReference {
  id: string;
  identity: string;
  store_id: string;
  resolved: boolean;
}

export interface SessionEvidence {
  extraction_status: "complete" | "partial" | "metadata_only";
  last_observed_activity_at: string | null;
  export_session_id: string | null;
  title: string;
  title_basis: "index" | "session_metadata" | "first_user_message" | "database" | "fallback";
  directory: string | null;
  directory_basis: "session_metadata" | "index" | "database" | null;
  directory_semantics:
    | "initial_cwd"
    | "first_observed_cwd"
    | "project_path"
    | "stored_directory"
    | null;
  last_message_at: string | null;
  last_tool_event_at: string | null;
  metadata_updated_at: string | null;
  last_activity_at: string | null;
  activity_basis: "session_event" | "index_update" | "database_update" | "file_mtime" | null;
  parent_id: string | null;
  fork_session_id: string | null;
  parent_session_path: string | null;
  is_subagent: boolean | null;
  archived: boolean | null;
}

export interface InventorySession extends SessionEvidence {
  id: string;
  extractor: string;
  /** Identity is local to the host and configured store. */
  identity: string;
  canonical_identity: string | null;
  parent_ref: SessionReference | null;
  fork_ref: SessionReference | null;
  copies: (SessionEvidence & { path: string })[];
}

export interface InventoryWarning {
  code: string;
  path: string;
  line?: number;
  session_id: string | null;
  session_identity: string | null;
  message: string;
  affects_completeness: boolean;
}

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : {};
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
/** Timestamp numbers are Unix milliseconds. Never turn null into the Unix epoch. */
function timestamp(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const millis = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(millis) && Math.abs(millis) <= 8.64e15
    ? new Date(millis).toISOString()
    : null;
}
function latest(a: string | null, b: string | null): string | null {
  return !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b;
}
function prompt(value: unknown, maxLength = 120): string | null {
  const content = Array.isArray(value)
    ? value.map((part) => string(object(part).text) ?? "").join(" ")
    : string(value);
  return content?.replace(/\s+/g, " ").trim().slice(0, maxLength) || null;
}
function titlePrompt(value: unknown, extractor: string): string | null {
  const text = prompt(value, Infinity);
  if (
    !text ||
    (extractor === "codex" && isInjectedPrompt(text)) ||
    (extractor === "claude" && isMetaPrompt(text))
  )
    return null;
  return text.slice(0, 120);
}

function base(extractor: string, id: string): InventorySession {
  return {
    id,
    extractor,
    identity: `${extractor}:${id}`,
    canonical_identity: null,
    extraction_status: "metadata_only",
    last_observed_activity_at: null,
    export_session_id: null,
    parent_ref: null,
    fork_ref: null,
    copies: [],
    title: `${extractor} session`,
    title_basis: "fallback",
    directory: null,
    directory_basis: null,
    directory_semantics: null,
    last_message_at: null,
    last_tool_event_at: null,
    metadata_updated_at: null,
    last_activity_at: null,
    activity_basis: null,
    parent_id: null,
    fork_session_id: null,
    parent_session_path: null,
    is_subagent: null,
    archived: null,
  };
}

/** Fresh scan for each request. Legacy picker caches and limits do not affect this contract. */
export async function scanSessionInventory(
  config: ResolvedConfig,
  directory?: string,
  options: { all?: boolean; limit?: number } = {},
) {
  const startedAt = new Date().toISOString();
  const extractor = config.extractor;
  const locations =
    extractor === "codex"
      ? [
          { role: "sessions", path: config.codex.sessionsPath },
          { role: "archives", path: config.codex.archivedPath },
          {
            role: "index",
            path: path.join(path.dirname(config.codex.sessionsPath), "session_index.jsonl"),
          },
        ]
      : extractor === "claude"
        ? [{ role: "projects", path: config.claude.projectsPath }]
        : extractor === "pi"
          ? [{ role: "sessions", path: config.pi.sessionsPath }]
          : [{ role: "database", path: config.picker.databasePath }];
  const roots = locations.map((location) => ({
    ...location,
    normalized_path: normalizeDirectory(location.path),
  }));
  const storeId = createHash("sha256")
    .update(
      JSON.stringify({
        extractor,
        roots: roots.map(({ role, normalized_path }) => ({ role, path: normalized_path })),
      }),
    )
    .digest("hex");
  const warnings: InventoryWarning[] = [];
  const rows = new Map<string, InventorySession>();
  let readableRoots = 0;
  const warn = (
    code: string,
    file: string,
    message: string,
    affects = true,
    line?: number,
    id: string | null = null,
  ) => {
    warnings.push({
      code,
      path: file,
      message,
      affects_completeness: affects,
      session_id: id,
      session_identity: id ? `${extractor}:${id}` : null,
      ...(line ? { line } : {}),
    });
  };
  const ioWarning = (file: string, error: unknown, optional = false) => {
    const code = object(error).code;
    warn(
      code === "ENOENT" ? "storage_missing" : "storage_unreadable",
      file,
      error instanceof Error ? error.message : String(error),
      !(optional && code === "ENOENT"),
    );
  };
  const walk = (root: string, optional = false): string[] => {
    const files: string[] = [];
    const visit = (dir: string, isRoot: boolean) => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        if (isRoot) readableRoots++;
        for (const entry of entries) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) visit(full, false);
          else if (
            entry.isFile() &&
            (entry.name.endsWith(".jsonl") || entry.name === "sessions-index.json")
          )
            files.push(full);
          else if (entry.isSymbolicLink())
            warn("symlink_skipped", full, "Symbolic links are not followed.");
        }
      } catch (error) {
        ioWarning(dir, error, isRoot && optional);
      }
    };
    visit(root, true);
    return files.sort();
  };
  const readLines = async (file: string, consume: (record: RecordValue, line: number) => void) => {
    const stream = fs.createReadStream(file, { encoding: "utf8" });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    let number = 0;
    let readable = true;
    try {
      for await (const line of lines) {
        number++;
        if (!line.trim()) continue;
        try {
          const value: unknown = JSON.parse(line);
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Expected an object");
          consume(object(value), number);
        } catch {
          warn("malformed_record", file, "Skipped an invalid JSON record.", true, number);
        }
      }
    } catch (error) {
      readable = false;
      ioWarning(file, error);
    } finally {
      lines.close();
      stream.destroy();
    }
    return readable;
  };
  const put = (row: InventorySession, file: string) => {
    const {
      id,
      extractor: _extractor,
      identity: _identity,
      canonical_identity: _canonical,
      copies: _copies,
      parent_ref: _parent,
      fork_ref: _fork,
      ...evidence
    } = row;
    const previous = rows.get(id);
    row.copies = [...(previous?.copies ?? []), { ...evidence, path: file }];
    if (!previous) {
      rows.set(id, row);
      return;
    }
    warn(
      "duplicate_session",
      file,
      "Combined evidence from multiple copies of this session.",
      false,
      undefined,
      id,
    );
    // Prefer observed evidence over file/index updates when choosing display metadata.
    // The timestamp maxima below always use every copy, regardless of this choice.
    const ranked = [...row.copies].sort(
      (a, b) =>
        Number(b.last_observed_activity_at !== null) -
          Number(a.last_observed_activity_at !== null) ||
        Date.parse(b.last_observed_activity_at ?? b.last_activity_at ?? "1970-01-01") -
          Date.parse(a.last_observed_activity_at ?? a.last_activity_at ?? "1970-01-01") ||
        a.path.localeCompare(b.path),
    );
    const { path: _path, ...selected } = ranked[0]!;
    Object.assign(row, selected);
    const max = (field: "last_message_at" | "last_tool_event_at" | "metadata_updated_at") =>
      row.copies.reduce<string | null>((value, copy) => latest(value, copy[field]), null);
    row.last_message_at = max("last_message_at");
    row.last_tool_event_at = max("last_tool_event_at");
    row.last_observed_activity_at = latest(row.last_message_at, row.last_tool_event_at);
    row.metadata_updated_at = max("metadata_updated_at");
    if (row.last_observed_activity_at) {
      row.last_activity_at = row.last_observed_activity_at;
      row.activity_basis = "session_event";
    }
    row.extraction_status = row.copies.some((copy) => copy.extraction_status === "partial")
      ? "partial"
      : row.copies.some((copy) => copy.extraction_status === "complete")
        ? "complete"
        : "metadata_only";
    row.export_session_id =
      ranked.find((copy) => copy.export_session_id !== null)?.export_session_id ?? null;
    // Conflicts remain available in copies; do not present one directory/relationship
    // as authoritative just because that file was written later.
    for (const field of [
      "directory",
      "parent_id",
      "fork_session_id",
      "parent_session_path",
      "is_subagent",
    ] as const) {
      const values = new Set(
        row.copies.map((copy) => copy[field]).filter((value) => value !== null),
      );
      if (values.size > 1) {
        row[field] = null;
        row.extraction_status = "partial";
        warn(
          "conflicting_copies",
          file,
          `Copies disagree on ${field}; inspect copies for the original evidence.`,
          true,
          undefined,
          id,
        );
      } else if (row[field] === null && values.size === 1) {
        // Preserve known values when another copy simply lacks the field.
        const donor = row.copies.find((copy) => copy[field] !== null)!;
        Object.assign(row, { [field]: donor[field] });
        if (field === "directory") {
          row.directory_basis = donor.directory_basis;
          row.directory_semantics = donor.directory_semantics;
        }
      }
    }
    if (row.directory === null) {
      row.directory_basis = null;
      row.directory_semantics = null;
    }
    const archiveStates = new Set(row.copies.map((copy) => copy.archived));
    row.archived = archiveStates.size === 1 ? row.copies[0]!.archived : null;
    rows.set(id, row);
  };

  if (extractor === "opencode" || extractor === "opencode2") {
    const file = config.picker.databasePath;
    try {
      fs.accessSync(file, fs.constants.R_OK);
      const db = await openDatabase(file);
      try {
        const table = extractor === "opencode" ? "session" : "session_v2";
        const records = db.prepare(`SELECT * FROM ${table}`).all();
        readableRoots++;
        for (const value of records) {
          const record = object(value);
          const id = string(record.id);
          if (!id) {
            warn("invalid_session", file, "Skipped a database row without an ID.");
            continue;
          }
          const row = base(extractor, id);
          row.export_session_id = id;
          row.title = string(record.title) ?? row.title;
          row.title_basis = string(record.title) ? "database" : "fallback";
          row.directory = string(record.directory);
          row.directory_basis = row.directory ? "database" : null;
          row.directory_semantics = row.directory ? "stored_directory" : null;
          row.metadata_updated_at = timestamp(record.time_updated);
          row.last_activity_at = row.metadata_updated_at;
          row.activity_basis = row.last_activity_at ? "database_update" : null;
          row.parent_id = string(record.parent_id);
          row.fork_session_id = string(record.fork_session_id);
          row.is_subagent = "parent_id" in record ? row.parent_id !== null : null;
          row.archived =
            "time_archived" in record
              ? record.time_archived != null && record.time_archived !== 0
              : null;
          put(row, file);
        }
      } finally {
        db.close();
      }
    } catch (error) {
      ioWarning(file, error);
    }
  } else if (extractor === "codex" || extractor === "claude" || extractor === "pi") {
    const root =
      extractor === "codex"
        ? config.codex.sessionsPath
        : extractor === "claude"
          ? config.claude.projectsPath
          : config.pi.sessionsPath;
    const files = walk(root);
    const archiveFiles = extractor === "codex" ? walk(config.codex.archivedPath, true) : [];
    const archives = new Set(archiveFiles);
    const index = new Map<string, RecordValue>();
    if (extractor === "codex") {
      const indexPath = path.join(path.dirname(root), "session_index.jsonl");
      try {
        fs.accessSync(indexPath, fs.constants.R_OK);
        await readLines(indexPath, (record) => {
          const id = string(record.id);
          if (id) index.set(id, record);
          else warn("invalid_index_entry", indexPath, "Index entry has no session ID.");
        });
      } catch (error) {
        ioWarning(indexPath, error, true);
      }
    } else if (extractor === "claude") {
      for (const file of files.filter((name) => name.endsWith("sessions-index.json"))) {
        try {
          const data = object(JSON.parse(fs.readFileSync(file, "utf8")));
          if (!Array.isArray(data.entries)) throw new Error("Index has no entries array");
          for (const value of data.entries) {
            const record = object(value);
            const id = string(record.sessionId);
            if (id) index.set(id, record);
            else warn("invalid_index_entry", file, "Index entry has no session ID.");
          }
        } catch (error) {
          warn("invalid_index", file, error instanceof Error ? error.message : String(error));
        }
      }
    }
    const scannedPaths = new Set<string>();
    // Index paths can point outside the project tree. Include them so indexed sessions
    // get event timestamps too, and report stale/unreadable references explicitly.
    const indexedFiles =
      extractor === "claude"
        ? [...index.values()].flatMap((entry) =>
            string(entry.fullPath) ? [String(entry.fullPath)] : [],
          )
        : [];
    for (const file of [...files, ...archiveFiles, ...indexedFiles]) {
      if (!file.endsWith(".jsonl") || scannedPaths.has(file)) continue;
      scannedPaths.add(file);
      let id: string | null = null;
      let cwd: string | null = null;
      let title: string | null = null;
      let parent: string | null = null;
      let fork: string | null = null;
      let parentPath: string | null = null;
      let sidechain: boolean | null = null;
      let lastMessage: string | null = null;
      let lastTool: string | null = null;
      let titleBasis: InventorySession["title_basis"] = "fallback";
      let recognized = false;
      let sawActivityEvent = false;
      let legacyId: string | null = null;
      const warningStart = warnings.length;
      const readable = await readLines(file, (record, line) => {
        const payload = object(record.payload);
        if (
          extractor === "codex" &&
          !record.type &&
          string(record.id) &&
          "instructions" in record
        ) {
          legacyId = string(record.id);
        }
        if (extractor === "codex" && record.type === "session_meta") {
          recognized = true;
          id = string(payload.id) ?? string(payload.session_id);
          cwd = string(payload.cwd);
          parent = string(payload.parent_thread_id);
          const spawn = object(object(object(payload.source).subagent).thread_spawn);
          parent ??= string(spawn.parent_thread_id);
          fork = string(payload.forked_from_id);
        } else if (extractor === "pi" && record.type === "session") {
          recognized = true;
          id = string(record.id);
          cwd = string(record.cwd);
          parentPath = string(record.parentSession);
        } else if (extractor === "claude") {
          // Subagent transcripts reuse the parent's sessionId. Use the agent ID
          // in the filename, with the parent session as an explicit relationship.
          recognized ||= typeof record.sessionId === "string";
          const isChild = path.basename(path.dirname(file)) === "subagents";
          id ??= isChild
            ? `${path.basename(path.dirname(path.dirname(file)))}/${path.basename(file, ".jsonl")}`
            : string(record.sessionId);
          if (isChild) parent ??= path.basename(path.dirname(path.dirname(file)));
          cwd ??= string(record.cwd);
          if (typeof record.isSidechain === "boolean") sidechain = record.isSidechain;
        }
        const message = extractor === "codex" ? payload : object(record.message);
        const blocks = Array.isArray(message.content) ? message.content.map(object) : [];
        const hasText =
          typeof message.content === "string" ||
          blocks.some((block) =>
            ["text", "input_text", "output_text", "image", "input_image"].includes(
              String(block.type),
            ),
          );
        const toolEvent =
          extractor === "codex"
            ? record.type === "response_item" &&
              [
                "function_call",
                "function_call_output",
                "custom_tool_call",
                "custom_tool_call_output",
              ].includes(String(payload.type))
            : extractor === "pi"
              ? record.type === "message" &&
                (message.role === "toolResult" || blocks.some((block) => block.type === "toolCall"))
              : ["user", "assistant"].includes(String(record.type)) &&
                blocks.some((block) => ["tool_use", "tool_result"].includes(String(block.type)));
        const messageEvent =
          extractor === "codex"
            ? (record.type === "response_item" &&
                payload.type === "message" &&
                ["user", "assistant"].includes(String(payload.role))) ||
              (record.type === "event_msg" &&
                ["user_message", "agent_message"].includes(String(payload.type)))
            : extractor === "pi"
              ? record.type === "message" &&
                ["user", "assistant"].includes(String(message.role)) &&
                (hasText || !toolEvent)
              : ["user", "assistant"].includes(String(record.type)) && (hasText || !toolEvent);
        if (messageEvent || toolEvent) {
          sawActivityEvent = true;
          const eventTime = timestamp(record.timestamp);
          if (eventTime === null)
            warn(
              "invalid_activity_timestamp",
              file,
              "Recognized activity event has a missing or invalid timestamp.",
              true,
              line,
              id,
            );
          if (messageEvent) lastMessage = latest(lastMessage, eventTime);
          if (toolEvent) lastTool = latest(lastTool, eventTime);
        }
        if (
          !title &&
          messageEvent &&
          (message.role === "user" || record.type === "user" || payload.type === "user_message")
        ) {
          title = titlePrompt(message.content ?? payload.message, extractor);
          if (title) titleBasis = "first_user_message";
        }
        if (extractor === "pi" && record.type === "session_info" && string(record.name)) {
          title = string(record.name);
          titleBasis = "session_metadata";
        }
      });
      if (!readable && !id) continue;
      if (!id && extractor !== "codex") {
        const match = path
          .basename(file, ".jsonl")
          .match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
        id = match?.[1] ?? null;
      }
      if (!id) {
        if (warnings.length === warningStart)
          warn(
            recognized ? "invalid_session" : "unsupported_format",
            file,
            recognized
              ? "Recognized session metadata has no session ID."
              : "Session layout is not supported by this extractor.",
            true,
            undefined,
            legacyId,
          );
        continue;
      }
      for (const warning of warnings.slice(warningStart)) {
        warning.session_id = id;
        warning.session_identity = `${extractor}:${id}`;
      }
      const indexed = index.get(id);
      const row = base(extractor, id);
      const indexedTitle =
        string(indexed?.thread_name) ?? titlePrompt(indexed?.firstPrompt, extractor);
      row.title = indexedTitle ?? title ?? row.title;
      row.title_basis = indexedTitle ? "index" : titleBasis;
      row.directory = cwd ?? string(indexed?.projectPath);
      row.directory_basis = cwd ? "session_metadata" : row.directory ? "index" : null;
      row.directory_semantics = cwd
        ? extractor === "claude"
          ? "first_observed_cwd"
          : "initial_cwd"
        : row.directory
          ? "project_path"
          : null;
      let mtime: string | null = null;
      try {
        if (readable) mtime = timestamp(fs.statSync(file).mtimeMs);
      } catch (error) {
        ioWarning(file, error);
      }
      row.metadata_updated_at = timestamp(indexed?.updated_at ?? indexed?.modified) ?? mtime;
      row.last_message_at = lastMessage;
      row.last_tool_event_at = lastTool;
      const activity = latest(lastMessage, lastTool);
      row.last_observed_activity_at = activity;
      row.last_activity_at = activity ?? mtime;
      row.activity_basis = activity ? "session_event" : mtime ? "file_mtime" : null;
      row.parent_id = parent;
      row.fork_session_id = fork;
      row.parent_session_path = parentPath;
      row.is_subagent = parent
        ? true
        : (sidechain ?? (typeof indexed?.isSidechain === "boolean" ? indexed.isSidechain : null));
      row.archived = extractor === "codex" ? archives.has(file) : null;
      row.extraction_status = warnings
        .slice(warningStart)
        .some((warning) => warning.affects_completeness)
        ? "partial"
        : sawActivityEvent
          ? "complete"
          : "metadata_only";
      row.export_session_id = readable && !(extractor === "claude" && parent) ? id : null;
      // Include stat failures, which occur after the earlier parsing diagnostics.
      for (const warning of warnings.slice(warningStart)) {
        warning.session_id = id;
        warning.session_identity = row.identity;
      }
      put(row, file);
    }
    // Keep indexed sessions even when their transcripts are absent, without
    // presenting index updates as measured conversation activity.
    if (extractor === "claude")
      for (const [id, entry] of index) {
        if (rows.has(id)) continue;
        const row = base(extractor, id);
        const indexedTitle = titlePrompt(entry.firstPrompt, extractor);
        row.title = indexedTitle ?? row.title;
        row.title_basis = indexedTitle ? "index" : "fallback";
        row.directory = string(entry.projectPath);
        row.directory_basis = row.directory ? "index" : null;
        row.directory_semantics = row.directory ? "project_path" : null;
        row.metadata_updated_at = timestamp(entry.modified) ?? timestamp(entry.fileMtime);
        row.last_activity_at = row.metadata_updated_at;
        row.activity_basis = timestamp(entry.modified)
          ? "index_update"
          : row.last_activity_at
            ? "file_mtime"
            : null;
        row.is_subagent = typeof entry.isSidechain === "boolean" ? entry.isSidechain : null;
        const existingWarnings = warnings.filter(
          (warning) => warning.path === string(entry.fullPath),
        );
        if (existingWarnings.length) {
          for (const warning of existingWarnings) {
            warning.session_id = id;
            warning.session_identity = row.identity;
          }
        } else
          warn(
            "transcript_unavailable",
            string(entry.fullPath) ?? root,
            `No readable transcript found for session ${id}.`,
            true,
            undefined,
            id,
          );
        put(row, string(entry.fullPath) ?? root);
      }
  } else {
    throw new Error(`Unsupported inventory extractor: ${extractor}`);
  }

  // Resolve references against the full inventory before filtering or limiting.
  const reference = (id: string | null): SessionReference | null =>
    id === null
      ? null
      : {
          id,
          identity: `${extractor}:${id}`,
          store_id: `${extractor}:${storeId}`,
          resolved: rows.has(id),
        };
  for (const row of rows.values()) {
    let parentId = row.parent_id;
    if (!parentId && row.parent_session_path && path.isAbsolute(row.parent_session_path)) {
      const matches = [...rows.values()].filter((candidate) =>
        candidate.copies.some(
          (copy) => normalizeDirectory(copy.path) === normalizeDirectory(row.parent_session_path!),
        ),
      );
      if (matches.length === 1) parentId = matches[0]!.id;
    }
    row.parent_ref = reference(parentId);
    row.fork_ref = reference(row.fork_session_id);
    if (extractor === "claude" && row.parent_id) {
      row.export_session_id = rows.get(row.parent_id)?.export_session_id ?? null;
    }
  }

  const configuredLimit =
    extractor === "codex"
      ? config.codex.limit
      : extractor === "claude"
        ? config.claude.limit
        : extractor === "pi"
          ? config.pi.limit
          : config.picker.limit;
  const limit = options.all ? null : (options.limit ?? configuredLimit);
  const target = directory === undefined ? null : normalizeDirectory(directory);
  const matched = [...rows.values()].filter(
    (row) =>
      target === null || (row.directory !== null && normalizeDirectory(row.directory) === target),
  );
  matched.sort(
    (a, b) =>
      (b.last_activity_at === null ? -Infinity : Date.parse(b.last_activity_at)) -
        (a.last_activity_at === null ? -Infinity : Date.parse(a.last_activity_at)) ||
      a.identity.localeCompare(b.identity),
  );
  const complete = !warnings.some((warning) => warning.affects_completeness);
  return {
    schema_version: 1,
    extractor,
    scope: {
      store_id: `${extractor}:${storeId}`,
      roots,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      archive_policy:
        extractor === "codex"
          ? "include_archive_root"
          : extractor.startsWith("opencode")
            ? "include_archived_rows"
            : "no_separate_archive_scan",
      follows_index_paths: extractor === "claude",
    },
    coverage: {
      effective_limit: limit,
      directory: target,
      discovered_sessions: rows.size,
      matched_sessions: matched.length,
      returned_sessions: limit === null ? matched.length : Math.min(limit, matched.length),
      truncated: limit !== null && matched.length > limit,
      scan_complete: complete,
      status: readableRoots === 0 ? "unavailable" : complete ? "complete" : "partial",
    },
    warnings,
    sessions: limit === null ? matched : matched.slice(0, limit),
  };
}
