# oc-export

Export and render chat sessions to standalone HTML files.

## Description

`oc-export` is a CLI tool that turns chat-session JSON exports into self-contained HTML files. It supports Opencode exports out of the box and can be extended with additional extractors for other formats. It can read existing JSON exports, export sessions directly from the local Opencode database, or present an interactive picker.

## Supported formats

- **Opencode JSON exports** (primary format)
- **Kagi Assistant JSON exports**

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

Run during development:

```bash
bun run dev
bun run dev --session abc123
```

## Sanitization

Sanitization is enabled by default. It redacts common PII (names, emails, phones, credit cards, SSNs) using `@redactpii/node` and replaces absolute file paths with relative paths or `~` references. Use `--raw` to disable it.

- Name detection is regex/greeting-based, so not every name will be caught.
- Paths with spaces or inside URLs are handled conservatively; local `file://` paths are still sanitized.

## Requirements

- Bun
- The `opencode` CLI must be installed and on PATH for `--session` and interactive picker modes.

## Generated output

Each HTML file is fully self-contained: all CSS and JavaScript are embedded inline, so no external network requests are required to view it.
