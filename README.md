# oc-export

Export and render chat sessions to standalone HTML files.

## Description

`oc-export` is a CLI tool that turns chat-session JSON exports into self-contained HTML files. It supports Opencode exports out of the box and can be extended with additional extractors for other formats. It can read existing JSON exports, export sessions directly from the local Opencode database, or present an interactive picker.

## Supported formats

- **Opencode JSON exports** (primary format)
- **Kagi Assistant JSON exports**
- **Open WebUI JSON exports**

Open WebUI exports may contain multiple conversation branches; only the currently selected branch is rendered.

Additional formats can be added by implementing an extractor in `src/extractors/` and registering it in `src/extractors/index.ts`.

## Installation

Install dependencies with Bun:

```bash
bun install
```

To make `oc-export` available globally while keeping the TypeScript source editable:

```bash
bun link
# Then in any directory:
bun link oc-export
oc-export --help
```

Alternatively, install globally from the local path:

```bash
bun install -g /path/to/oc-export
```

## Fish completions

A Fish completions file is included in `completions/oc-export.fish`. Copy it to your Fish completions directory:

```bash
cp completions/oc-export.fish ~/.config/fish/completions/
```

## Usage

Run the interactive picker to choose a recent session:

```bash
oc-export
```

Pick a session and write both files with custom names:

```bash
oc-export --output report
# Produces: report.json, report.html
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

Render multiple JSON exports:

```bash
oc-export a.json b.json
```

Export a session by full ID or last 8 characters:

```bash
oc-export --session abc123
oc-export --session abc123 --output report
# Produces: report.json, report.html
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

## Configuration file

`oc-export` reads settings from `~/.config/oc-export/config.jsonc` if the file exists. The file is JSONC, so comments are allowed. Missing files are ignored. Malformed files are fatal errors with a clear message.

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

### Supported options

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `raw` | boolean | `false` | Skip sanitization by default |
| `picker.databasePath` | string | `~/.local/share/opencode/opencode.db` | Path to the Opencode SQLite database |
| `picker.limit` | number | `20` | Number of recent sessions shown in the interactive picker |
| `summarize.enabled` | boolean | `false` | Master switch for the summarize feature |
| `summarize.model` | string | — | Model ID passed to `llm -m`; required when summarizing |
| `summarize.always` | boolean | `false` | Run summarization by default without `--summarize` |
| `summarize.prompt` | string | — | Custom system prompt for summarization |

## Summarization

When summarization is enabled, `oc-export` replaces collapsible thinking and tool-call blocks in assistant turns with concise summaries. This produces a shorter HTML file that is easier to skim.

Summarization relies on Simon Willison's [`llm`](https://llm.datasette.io/) CLI. You must have it installed and on PATH, and you must configure a model ID in `~/.config/oc-export/config.jsonc`:

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

Sanitization runs before summarization, so the model only sees redacted content. The model ID cannot be supplied via the CLI.

## Sanitization

Sanitization is enabled by default. It redacts common PII (names, emails, phones, credit cards, SSNs) using `@redactpii/node` and replaces absolute file paths with relative paths or `~` references. Use `--raw` to disable it, or `--no-raw` to re-enable it when `raw: true` is set in the config.

- Name detection is regex/greeting-based, so not every name will be caught.
- Paths with spaces or inside URLs are handled conservatively; local `file://` paths are still sanitized.

## Requirements

- Bun
- The `opencode` CLI must be installed and on PATH for `--session` and interactive picker modes.
- The `llm` CLI must be installed and on PATH to use `--summarize`.

## Generated output

Each HTML file is fully self-contained: all CSS and JavaScript are embedded inline, so no external network requests are required to view it.
