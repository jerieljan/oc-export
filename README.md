# oc-export

oc-export allows you to export and render chat sessions to standalone HTML files.
This project was built primarily with *OpenCode* in mind, but also planning to support other formats.

---

[![npm](https://img.shields.io/npm/v/oc-export.svg)](https://www.npmjs.com/package/oc-export)

---

## Example

You can see an example of how the generated HTML looks like here, with summarization enabled: https://oc-export-demo.jerieljan.dev

## Why?

`opencode` already supports export, either via `/export` or `opencode export`. 

oc-export makes use of this, and does the following:

- it exports them additionally in HTML that's meant to be shared standalone.
- it also lets you point to a manual export file and produce similar HTML files.
- the picker operates a bit differently; it just shows recent sessions overall, not just the current directory.
- you have a bit more control over the configuration section.

This project was built with the HTML export in mind. My pain point was that I always want to share
sessions with others and sure, I can just use the built-in functions for these, but I want portable HTML files for sharing manually or on a drop service like [Cloudflare Drop](https://www.cloudflare.com/drop/).

Each HTML file has CSS and JavaScript embedded inline; fonts are loaded from Google Fonts.

*The HTML export has these capabilities:*

- you can choose to have thinking and tool calls summarized
- you can have a summary at the top
- a navigation scrubber that runs horizontally, rather than vertically, like a book reader
- basic sanitization of data and file paths
- it works adequately on mobile (work in progress, it's not that great yet)

These options are configured either via flags or the config.jsonc file. See the configuration section for more information.

## Quick Start

### Requirements

- Node 20+ **or** a working Bun setup.
- The `opencode` CLI must be installed and on PATH for `--session` and interactive picker modes.
- When using the OpenCode V2 extractor, the `opencode2` CLI must be installed and on PATH.
- When using the Claude Code extractor, this project reads `~/.claude/projects` directly.
- When using the Codex extractor, this project reads `~/.codex` directly; no extra CLI is needed.
- When using summarization, the `llm` CLI must be installed.

### Instructions

#### From npm (recommended for end users)

```bash
npm install -g oc-export
oc-export --help
```

Or run without installing:

```bash
npx oc-export --help
```

#### From source (for development)

- Clone this repository
- `bun install` to set up dependencies.
- Use `bun run oc-export` to run locally. Use `bun link` so you can invoke oc-export anywhere.

Development commands:

```bash
bun run typecheck        # TypeScript check across source and build config
bun run lint             # Biome lint + format check
bun run lint:fix         # Biome lint + format with auto-fixes applied
bun run test:config-schema
```

CI runs these checks on every push to `master` and pull request.

While running oc-export:

- If you have OpenCode present, it will show you your recent sessions and export both the JSON and HTML result.
- If you have a file, you can provide it with oc-export <file> and it'll produce the HTML equivalent.

Some of the common flags you can use:

- `--session <id>` - if you already know the session ID to export, this does it directly. Helpful for scripts and agents.
- `--raw` - if you don't want sanitization (which operates by default), pass this to produce what the sources provide.
- `--summarize` - if you have `llm` configured, this triggers summarization. **Requires setup**, so check the Summarization section below.

Scroll down to the Usage section if you want to know more.

## Supported Formats

These are the supported formats. This is a work in progress.

- **OpenCode JSON exports** (primary format, V1)
- **OpenCode V2 JSON exports** via `opencode2 export` (experimental)
- **Claude Code JSONL exports** (experimental)
- **Pi JSONL exports** (experimental)
- **OpenAI Codex rollout JSONL exports** (experimental)
- **Kagi Assistant JSON exports**
- **Open WebUI JSON exports**

Open WebUI exports may contain multiple conversation branches; only the currently selected branch is rendered.

Claude Code sessions are read directly from `~/.claude/projects`. Subagent conversations are inlined into the parent session as tool-call blocks.

Codex sessions are read directly from `~/.codex/sessions` and `~/.codex/archived_sessions` (modern rollout format; legacy pre-0.4x rollouts are skipped). Session titles come from `~/.codex/session_index.jsonl` when available, falling back to the first user prompt. Codex subagent sessions (rollouts with a `parent_thread_id`) are exported as a family: the parent HTML links to each child and the child links back to the parent. Reasoning text is only available when Codex stored readable summaries; encrypted reasoning cannot be recovered.

OpenCode, OpenCode V2, and Codex sessions that spawn subagents (or forks) are exported as a family: the parent HTML links to each child session and the child HTML links back to the parent. Choosing a parent session in the picker or via `--session` exports the parent and all of its children.

Additional formats can be added by implementing an extractor in `src/extractors/` and registering it in `src/extractors/index.ts`.

## AI-generated Disclosure

This project started as a personal tool, so most of the application code is AI-generated, but highly steered and reviewed by a human.

## Usage

If you have the project installed globally, here are the commands that you can execute:

Once published, replace `oc-export` with `npx oc-export` in these examples if you
prefer not to install it globally. Run `npx oc-export --help` for export and render
options, or `npx oc-export ls --help` for listing options.

### Fish completion

Install the command and its bundled completions (after publication):

```fish
npm install -g oc-export
mkdir -p ~/.config/fish/completions
cp (npm root -g)/oc-export/completions/oc-export.fish ~/.config/fish/completions/
source ~/.config/fish/completions/oc-export.fish
```

For development, copy `completions/oc-export.fish` from this repository instead.
The built `oc-export` command must be on `PATH` for dynamic session suggestions.

Type `oc-export --extractor codex --session `, then press Tab. Fish suggests full
session IDs with their titles and working directories. `--session=` also works.
Pressing Tab immediately after `--session` completes the option itself; add a
space to complete its value.

Suggestions use `ls` and respect `--extractor` and `--config` before the cursor,
including `--flag=value` syntax. Without an explicit extractor, they use the
configured source. They show the same recent sessions and limits as `ls`, across
all working directories. Missing sources and empty lists produce no suggestions.
Completion does not export sessions or install packages. Use the installed
`oc-export` command for this completion setup; `npx` completion depends on your
shell's separate `npx` support.

### List sessions

List recent sessions without a prompt or an export:

```sh
oc-export ls                             # uses the configured extractor
oc-export ls --extractor codex           # recent Codex sessions
oc-export ls --extractor codex .          # sessions in the current directory
oc-export ls --extractor claude /path/to/project
```

`ls` prints full session IDs, UTC update times, working directories, and titles as
tab-separated columns. Use an ID with `--session` to export it. Listings show local
metadata as stored, without export sanitization. An empty result prints
`No sessions found.` and exits successfully.

For the compatible JSON array, use `--json`:

```sh
npx oc-export ls --extractor codex --json
npx oc-export --extractor codex --session SESSION_ID --output report
```

Replace `SESSION_ID` with a full `id` returned by the first command. `--json`
prints an array of objects with `id`, `title`, `directory`, and `time_updated`
(Unix milliseconds); sources may also include `cost`. An empty result is `[]`.
Errors go to stderr with exit status 1; successful listings exit with status 0.
All listing modes expose local metadata without sanitization. Neither prompts
for input or writes export files.

The optional path matches the exact working directory, not its subdirectories.
Relative paths, trailing slashes, and symlinks are resolved before matching.
Filtering happens before the configured limit (`picker.limit`, or `claude.limit`,
`pi.limit`, or `codex.limit` for that source). Results show the newest sessions first.
`--config` and `--extractor` work as usual; export-only flags are not accepted by `ls`.

For complete retrieval, use `--all`. To set a caller-controlled cap, use
`--limit N`, where N is a positive integer. These flags work with text, `--json`,
and `--json-extended`, override picker/source limits, and cannot be combined. Without
either flag, the existing configured limit still applies.

For programmatic inventories, use extended JSON output:

```sh
oc-export ls --extractor codex --all --json-extended
oc-export ls --extractor claude --limit 100 --json-extended /path/to/project
```

`--json-extended` and `--json` cannot be combined. Extended JSON has this shape:

```json
{
  "schema_version": 1,
  "extractor": "codex",
  "scope": {
    "store_id": "codex:<sha256-of-source-and-resolved-storage-locations>",
    "roots": [
      { "role": "sessions", "path": "/data/codex/sessions", "normalized_path": "/data/codex/sessions" },
      { "role": "archives", "path": "/data/codex/archived_sessions", "normalized_path": "/data/codex/archived_sessions" },
      { "role": "index", "path": "/data/codex/session_index.jsonl", "normalized_path": "/data/codex/session_index.jsonl" }
    ],
    "started_at": "2026-09-24T10:30:00.000Z",
    "finished_at": "2026-09-24T10:30:00.500Z",
    "archive_policy": "include_archive_root",
    "follows_index_paths": false
  },
  "coverage": {
    "effective_limit": null,
    "directory": null,
    "discovered_sessions": 0,
    "matched_sessions": 0,
    "returned_sessions": 0,
    "truncated": false,
    "scan_complete": true,
    "status": "complete"
  },
  "warnings": [],
  "sessions": []
}
```

`scope` describes the scan, including configured locations, their resolved paths,
and UTC start/end times. `store_id` hashes the extractor and resolved storage
locations. It is stable across scans with the same configuration, independent of
filters and limits. It is a **local configuration identifier**, not a durable
store UUID or proof of session equivalence. A move or a changed symlink target
can change it; identical paths on different machines can match. When combining
inventories, key records by host, `scope.store_id`, and `identity`.
`archive_policy` is `include_archive_root` for Codex, `include_archived_rows` for
OpenCode, or `no_separate_archive_scan` for Claude/Pi. This describes scan policy,
not a guarantee that an archive exists or was readable. `follows_index_paths`
is true for Claude, whose index can reference transcripts outside the roots.

`effective_limit: null` means no cap. The three counts describe discovered,
matching, and returned sessions. `truncated` reports whether the cap removed
known matching sessions; it does **not** mean the scan was complete.
`scan_complete` is false if storage or records could not be checked. `status`
is `complete`, `partial` (some storage could be read), or `unavailable` (no
storage could be read). A complete scan with zero sessions is a valid empty result.
Each warning has `code`, `path`, `message`, `affects_completeness`, nullable
`session_id` and `session_identity`, and an optional one-based `line`.
`unsupported_format` means a valid record layout is not supported;
`malformed_record` means a record could not be parsed as a JSON object. Missing storage, unreadable storage, malformed records, invalid
index entries, unavailable transcripts, skipped symlinks, and duplicate IDs are
reported explicitly. Missing optional Codex archive/index paths and duplicate
copies are warnings that do not by themselves make a scan incomplete.

An incomplete extended JSON scan still writes its response to stdout and exits with
status 1. Complete scans, including capped scans, exit with status 0. Invalid
arguments or configuration errors go to stderr and may produce no JSON response.
Subprocess libraries may reject on exit status 1; adapters must recover stdout
from that error, validate `schema_version` and the response shape, and retain
usable partial results. Callers should capture stdout even on status 1 and inspect coverage before
interpreting an empty result as no activity. The legacy array keeps its existing
fields and behavior, including its timestamp meaning and limited diagnostics.

Extended JSON session fields:

| Field | Meaning |
| --- | --- |
| `id`, `extractor`, `identity` | Source ID, source name, and an identity formed as `extractor:id`. |
| `canonical_identity` | Cross-store identity when established; currently always `null`. |
| `title`, `title_basis` | Title with basis `index`, `session_metadata`, `first_user_message`, `database`, or `fallback`. Injected Codex context and Claude command metadata are excluded from prompt-derived titles using the same heuristics as legacy listings. |
| `directory`, `directory_basis` | Recorded directory or `null`; basis is `session_metadata`, `index`, `database`, or `null`. Pi folder names are never decoded into guessed paths. |
| `directory_semantics` | `initial_cwd` for Codex/Pi header directories; `first_observed_cwd` for Claude transcript directories; `project_path` for Claude index directories; `stored_directory` for OpenCode; otherwise `null`. This does not identify every project a session touched. |
| `last_observed_activity_at` | Later of the message and tool timestamps, without fallback; `null` when no valid observed event time is available. Use this for ranking that excludes estimated activity. |
| `extraction_status` | `complete` for a transcript with recognized activity events and no extraction failures; `partial` if record failures or conflicting copies may affect the result; `metadata_only` when only metadata was obtained. OpenCode database rows and unavailable indexed transcripts are metadata-only. |
| `copies` | Source locations and their individual timestamps, bases, extraction status, directories, relationships, archive state, and export targets. Present even for a single copy. |
| `last_message_at` | Latest recognized user/assistant message timestamp; `null` when unavailable. Never falls back to file, index, or database updates. |
| `last_tool_event_at` | Latest recognized tool call/result timestamp; `null` when unavailable. It does not prove that a tool succeeded or is still running. |
| `metadata_updated_at` | Index update time, falling back to file modification time; database update time for OpenCode. |
| `last_activity_at`, `activity_basis` | Latest recognized conversation-event timestamp, or a labeled approximation. |
| `parent_id`, `fork_session_id` | Parent or fork origin when recorded; otherwise `null`. |
| `parent_ref`, `fork_ref` | Nullable references with `id`, `identity`, `store_id`, and `resolved`. Resolution uses the full scan before directory filtering and limits; `resolved: false` means the ID is known but its record was not found. Pi absolute parent paths are resolved only when they uniquely match a scanned copy. |
| `export_session_id` | ID to pass to `--session` with the same extractor/configuration. Claude child sessions use their available parent; unavailable targets are `null`. This identifies an export target, not a guarantee that the export command or storage will remain available. |
| `parent_session_path` | Pi's recorded parent-session file path, when available. |
| `is_subagent` | Relationship indicator when available; `null` means unknown. A fork alone does not imply a subagent. |
| `archived` | Whether a Codex copy is in archive storage, or an OpenCode archive timestamp is set. For merged rows, copies must agree; `null` means unavailable or mixed states. Inspect `copies` for individual states. |

All extended JSON timestamp values are UTC ISO strings or `null`.
`last_observed_activity_at` is the later of `last_message_at` and `last_tool_event_at`.
`last_activity_at` uses that observed timestamp when available,
with `activity_basis: "session_event"`. If neither is available, it uses a
labeled approximation: `file_mtime`, `index_update`, or `database_update`.
Unknown activity has a null timestamp and basis. OpenCode currently supplies
only database update times, so its observed, message, and tool timestamps are null.
Missing or invalid timestamps on recognized activity events produce an
`invalid_activity_timestamp` warning, mark the transcript `partial`, and make
the scan incomplete. Valid earlier observations remain available. A partial
observed timestamp is a lower bound on activity found, not proof of the actual
latest event. `metadata_only` describes extraction depth; consult scan coverage
and warnings separately to distinguish a successful metadata read from a missing
transcript. A header-only transcript is also metadata-only.

Message events are Codex `response_item` user/assistant messages and `event_msg`
user/agent messages, Claude user/assistant records, or Pi user/assistant messages.
Tool events are Codex `response_item` function/custom-tool calls and outputs,
Claude `tool_use`/`tool_result` content blocks, and Pi `toolCall` blocks or
`toolResult` messages. Claude/Pi records containing only tool content advance
the tool timestamp, not the message timestamp. Mixed text/tool records can
advance both. Tool events use the enclosing record's timestamp; they are not
measurements of continuous execution. Unsupported tool-event variants do not
advance the tool timestamp. Other metadata events do not advance either field.

File writes, index updates, and database updates are **approximations**, not
proof of user activity. A recent timestamp never implies that an agent is running.
Extended JSON sorts by activity, newest first, then identity, with unknown activity
last. Legacy listings continue to sort by `time_updated`.

The extended JSON file scan reads entire transcripts, including nested Claude
subagent transcripts. This costs more I/O than the picker. Claude subagent IDs
use `parent-session-id/agent-filename` because their embedded `sessionId` can
refer to the parent. These composite IDs identify inventory records; the current
Claude `--session` export workflow exports subagents through their parent; use
`export_session_id` rather than deriving that target from the inventory ID.

Copies with the same ID within one extractor/store are combined. Message and
tool timestamps each take the maximum valid observation across copies. Observed
evidence always takes precedence over file/index update approximations. Metadata
update time also takes the maximum. Display metadata prefers copies with observed
events, then the latest activity, then the source path as a deterministic tie-break.
All original copy evidence remains in `copies`. Any partial copy makes the
combined extraction partial. Otherwise it is complete if at least one copy has
complete event extraction, or metadata-only if all copies are metadata-only.
Conflicting known directories or relationships produce `conflicting_copies`,
mark extraction partial and scan completeness false, and set the combined field
to null. Unknown values alone are not conflicts. A conflicting directory will
not pass the exact-directory filter; callers can inspect its copies when matching
projects. Mixed archive states are retained per copy, with a null combined state. Scans do not follow symlinks or provide an atomic snapshot
of files being written. Completeness describes the supported configured storage
at scan time, not deleted sessions or every possible tool storage format.

OpenCode and OpenCode2 IDs can overlap after a store migration or copy, but this
repository does not establish that all matching IDs are the same logical session.
Their identities remain separate and `canonical_identity` stays `null`; do not
blindly add their counts or deduplicate them solely by ID. Choose an authoritative
store, or reconcile records using migration information held by the caller.
Parent and fork fields allow callers to count root sessions separately while
including child activity. Exact-directory filtering remains available; callers
that need descendant/project matching can fetch once per extractor with `--all`
and apply their own matching to recorded directories.

The machine-checkable contract is [inventory-extended.schema.json](schemas/inventory-extended.schema.json)
(JSON Schema draft 2020-12), included in the published package. Inventory tests
validate responses from every extractor, including partial and unavailable scans.
The schema checks structure and known enum values; timestamp aggregation,
reference resolution, and coverage consistency are also covered by behavioral tests.

Compatibility rules for extended JSON output:

- Consumers must check `schema_version` before interpreting a response.
- New optional fields and new warning codes may be added within the same schema version. Ignore unknown
  fields. Handle unknown warning codes using `affects_completeness` and the scan's
  coverage instead of assuming success.
- Removing fields, adding required fields, changing existing field types or
  meanings, and adding values to closed enums require a new schema version.
- Treat an unknown enum value as unsupported data; do not interpret it as complete
  extraction or a trusted activity basis. The published schema rejects it.
The extended JSON format starts at `schema_version: 1`. This version identifies
the extended schema; it does not replace the existing `--json` array format.

Integrations should probe the installed command for `--json-extended` support and
validate a response against this schema. The repository build can be newer than
the command on PATH. Rank by `last_observed_activity_at` for observed activity;
retain estimated `last_activity_at` and `activity_basis` for display or an explicit
fallback policy. Continue to accept valid partial JSON on exit status 1.

Run the interactive picker to choose a recent session:

```bash
oc-export
```

Use Claude Code sessions instead of OpenCode:

```bash
oc-export --extractor claude
# Produces: session-id.jsonl, session-id.html

oc-export --extractor claude --output report
# Produces: report.jsonl, report.html
```

Use OpenCode V2 (opencode2) sessions:

```bash
oc-export --extractor opencode2
# Produces: session-id.jsonl, session-id.html

oc-export --extractor opencode2 --output report
# Produces: report.jsonl, report.html
```

Use OpenAI Codex sessions:

```bash
oc-export --extractor codex
# Produces: session-id.jsonl, session-id.html

oc-export --extractor codex --output report
# Produces: report.jsonl, report.html
```

Pick a session and write both files with custom names:

```bash
oc-export --output report
# Produces: report.jsonl, report.html
```

Render an existing JSON export:

```bash
oc-export session.json
```

Render with a custom output filename:

```bash
oc-export session.json --output report
# Produces: report.html
```

Export a session by full ID or last 8 characters:

```bash
oc-export --session abc123
oc-export --session abc123 --output report
# Produces: report.jsonl, report.html

# With the Claude Code source:
oc-export --extractor claude --session abc123
oc-export --extractor claude --session abc123 --output report
# Produces: report.jsonl, report.html

# With the OpenCode V2 source:
oc-export --extractor opencode2 --session abc123
oc-export --extractor opencode2 --session abc123 --output report
# Produces: report.jsonl, report.html

# With the OpenAI Codex source:
oc-export --extractor codex --session abc123
oc-export --extractor codex --session abc123 --output report
# Produces: report.jsonl, report.html
```

Skip sanitization with `--raw`:

```bash
oc-export session.json --raw
oc-export --session abc123 --raw
```

Summarize thinking and tool-call blocks with `--summarize`:

```bash
oc-export session.json --summarize
oc-export --session abc123 --summarize
```

Run during development:

```bash
bun run dev
bun run dev --session abc123
```

## Configuration

`oc-export` reads settings from `~/.config/oc-export/config.jsonc` if the file exists. 

The file is JSONC, so comments are allowed. Missing files are ignored. Malformed files are fatal errors with a clear message.

A JSON Schema for the config file is available at `schemas/config-schema.json`. You can add `"$schema": "./schemas/config-schema.json"` to your config for editor autocomplete and validation.

CLI flags always override config values. Config values override built-in defaults.

A starter template is included in this repo as `config-example.jsonc`. Copy it to `~/.config/oc-export/config.jsonc` and edit from there:

```bash
mkdir -p ~/.config/oc-export
cp config-example.jsonc ~/.config/oc-export/config.jsonc
```

### Example

Create `~/.config/oc-export/config.jsonc` to make `--raw` the default and change the interactive picker limit:

```jsonc
{
  // Skip sanitization by default
  "raw": true,
  "picker": {
    "databasePath": "~/.local/share/opencode/opencode.db",
    "limit": 20
  }
}
```

Override `raw: true` for a single run:

```bash
oc-export session.json --no-raw
```

Use a custom config file:

```bash
oc-export --config ~/.oc-export.jsonc session.json
```

### Supported Options

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `raw` | boolean | `false` | Skip sanitization by default |
| `extractor` | string | `opencode` | Default session source: `opencode`, `opencode2`, `claude`, `pi`, or `codex` |
| `username` | string | — | Display name used on the user-turn badge, rendered in uppercase |
| `picker.databasePath` | string | `~/.local/share/opencode/opencode.db` | Path to the OpenCode SQLite database |
| `picker.limit` | number | `20` | Number of recent sessions shown in the interactive picker and `ls` |
| `claude.projectsPath` | string | `~/.claude/projects` | Path to the Claude Code projects directory |
| `claude.limit` | number | `picker.limit` | Number of recent Claude sessions shown in the interactive picker and `ls` |
| `pi.sessionsPath` | string | `~/.pi/agent/sessions` | Path to the Pi sessions directory |
| `pi.limit` | number | `picker.limit` | Number of recent Pi sessions shown in the interactive picker and `ls` |
| `codex.sessionsPath` | string | `~/.codex/sessions` | Path to the Codex sessions directory (rollout files) |
| `codex.archivedPath` | string | `~/.codex/archived_sessions` | Path to the Codex archived sessions directory |
| `codex.limit` | number | `picker.limit` | Number of recent Codex sessions shown in the interactive picker and `ls` |
| `summarize.enabled` | boolean | `false` | Master switch for the summarize feature |
| `summarize.model` | string | — | Model ID passed to `llm -m`; required when summarizing |
| `summarize.always` | boolean | `false` | Run summarization by default without `--summarize` |
| `summarize.prompt` | string | — | Custom system prompt used for both block types |
| `summarize.thinkingPrompt` | string | — | Custom system prompt for thinking summaries |
| `summarize.toolsPrompt` | string | — | Custom system prompt for tool-call summaries |
| `summarize.sessionSummary.enabled` | boolean | `false` | Generate a top-level session summary after per-turn summaries |
| `summarize.sessionSummary.prompt` | string | — | Custom system prompt for the session summary |
| `summarize.sessionSummary.collapsed` | boolean | `true` | Start the session summary panel collapsed; set to `false` to expand it by default |
| `navigation.enabled` | boolean | `true` | Show the bottom turn navigation bar |
| `navigation.minTurns` | number | `0` | Only show the bar when the session has at least this many turns |
| `navigation.progressBar` | boolean | `true` | Show a thin progress line at the top of the bar |
| `navigation.roleColor` | boolean | `false` | Opt in to color pills by role: darker for user turns, lighter for assistant turns |

## Summarization

When summarization is enabled, `oc-export` replaces collapsible thinking and tool-call blocks in assistant turns with concise summaries. 

This produces a shorter HTML file that is easier to skim, and to some degree helps avoid sharing raw details with others if sanitization fails.

**Summarization relies on Simon Willison's [`llm`](https://llm.datasette.io/) CLI.**

**You must have it installed and on PATH, and you must configure a model ID in `~/.config/oc-export/config.jsonc`**.

```jsonc
{
  "summarize": {
    "enabled": true,
    "model": "gpt-4o-mini"
  }
}
```

With that config in place, run:

```bash
oc-export session.json --summarize
```

Set `summarize.always` to `true` to summarize by default without passing `--summarize`.

You can override the prompts with `summarize.prompt` (applies to both block types) or with `summarize.thinkingPrompt` and `summarize.toolsPrompt` for independent control. The type-specific prompts take precedence over `prompt`.

Set `summarize.sessionSummary.enabled` to `true` to add a top-level "Session summary" panel at the start of the HTML. This summary runs after all per-turn summaries are complete, so it summarizes the existing summaries instead of the full tool and thinking traces. You can override its prompt with `summarize.sessionSummary.prompt`.

By default the session summary panel starts collapsed. Set `summarize.sessionSummary.collapsed` to `false` to expand it by default.

*Sanitization runs before summarization, so the model only sees redacted content.* The model ID cannot be supplied via the CLI.

## Sanitization

Sanitization is enabled by default. It redacts common PII (names, emails, phones, credit cards, SSNs) using `@redactpii/node` and replaces absolute file paths with relative paths or `~` references.

Use `--raw` to disable it, or `--no-raw` to re-enable it when `raw: true` is set in the config.

- Name detection is regex/greeting-based, so not every name will be caught.
- Paths with spaces or inside URLs are handled conservatively; local `file://` paths are still sanitized.
