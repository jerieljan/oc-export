# opencode-chat-render

Date Created: 2026-07-16 15:23

## Description

A renderer for exported Opencode chat discussions. It takes one or more session markdown files and produces a single, standalone HTML file for each session.

## Usage

Install dependencies with Bun:

```bash
bun install
```

Render a single session:

```bash
bun render.ts session-ses_0963.md
```

Render multiple sessions:

```bash
bun render.ts sessions/*.md
```

Each input `session-*.md` produces a matching `session-*.html` in the same directory. The generated HTML is fully self-contained: all CSS and JavaScript are embedded inline, so no external network requests are required to view it.
