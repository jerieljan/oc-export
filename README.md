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

- Node 18+ **or** a working Bun setup.
- The `opencode` CLI must be installed and on PATH for `--session` and interactive picker modes.
- When using the OpenCode V2 extractor, the `opencode2` CLI must be installed and on PATH.
- When using the Claude Code extractor, this project reads `~/.claude/projects` directly.
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
- **Kagi Assistant JSON exports**
- **Open WebUI JSON exports**

Open WebUI exports may contain multiple conversation branches; only the currently selected branch is rendered.

Claude Code sessions are read directly from `~/.claude/projects`. Subagent conversations are inlined into the parent session as tool-call blocks.

OpenCode and OpenCode V2 sessions that spawn subagents (or forks) are exported as a family: the parent HTML links to each child session and the child HTML links back to the parent. Choosing a parent session in the picker or via `--session` exports the parent and all of its children.

Additional formats can be added by implementing an extractor in `src/extractors/` and registering it in `src/extractors/index.ts`.

## AI-generated Disclosure

This project started as a personal tool, so most of the application code is AI-generated, but highly steered and reviewed by a human.

## Usage

If you have the project installed globally, here are the commands that you can execute:

TIP: If you're using the fish shell, a completions file is available in `completions/oc-export.fish`. Place it on your fish completions directory.

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
| `extractor` | string | `opencode` | Default session source: `opencode`, `opencode2`, `claude`, or `pi` |
| `username` | string | — | Display name used on the user-turn badge, rendered in uppercase |
| `picker.databasePath` | string | `~/.local/share/opencode/opencode.db` | Path to the OpenCode SQLite database |
| `picker.limit` | number | `20` | Number of recent sessions shown in the interactive picker |
| `claude.projectsPath` | string | `~/.claude/projects` | Path to the Claude Code projects directory |
| `claude.limit` | number | `picker.limit` | Number of recent Claude sessions shown in the interactive picker |
| `pi.sessionsPath` | string | `~/.pi/agent/sessions` | Path to the Pi sessions directory |
| `pi.limit` | number | `picker.limit` | Number of recent Pi sessions shown in the interactive picker |
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
