import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import { sanitizePathForDisplay, sanitizeText } from "./sanitize.ts";
import { extractSession } from "./extractors/index.ts";
import {
  formatCost,
  formatDuration,
  formatTimestamp,
  formatTokens,
} from "./format.ts";
import type { SessionMeta, SessionStats, Turn } from "./types.ts";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

export interface RenderOptions {
  sanitize?: boolean;
  outputPath?: string;
}

function sanitizeSession(meta: SessionMeta, turns: Turn[]): void {
  meta.title = sanitizeText(meta.title);
  meta.sessionId = meta.sessionId ? sanitizeText(meta.sessionId) : undefined;
  meta.created = meta.created ? sanitizeText(meta.created) : undefined;
  meta.updated = meta.updated ? sanitizeText(meta.updated) : undefined;

  for (const turn of turns) {
    turn.content = sanitizeText(turn.content);
    turn.header = turn.header ? sanitizeText(turn.header) : undefined;
    turn.thinking = turn.thinking.map(sanitizeText);
    turn.synthetic = turn.synthetic.map(sanitizeText);

    for (const tool of turn.tools) {
      tool.name = sanitizeText(tool.name);
      tool.input = sanitizeText(tool.input);
      tool.output = sanitizeText(tool.output);
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function hashString(text: string): number {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) + hash + text.charCodeAt(i)!;
  }
  return Math.abs(hash);
}

function generateFavicon(title: string): string {
  const initial = title.trim().slice(0, 1).toUpperCase() || "?";
  const hue = hashString(title) % 360;
  const background = `hsl(${hue} 70% 55%)`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="${background}"/><text x="50" y="68" font-size="55" text-anchor="middle" fill="#ffffff" font-family="system-ui, -apple-system, BlinkMacSystemFont, &quot;Segoe UI&quot;, sans-serif" font-weight="700">${escapeHtml(initial)}</text></svg>`;
  const encoded = encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
  return `data:image/svg+xml,${encoded}`;
}

function statPair(label: string, value: string | undefined): string {
  const valueHtml =
    value === undefined
      ? `<dd class="stat-na">N/A</dd>`
      : `<dd>${escapeHtml(value)}</dd>`;
  return `<div class="stat-pair"><dt>${escapeHtml(label)}</dt>${valueHtml}</div>`;
}

function statBlank(): string {
  return `<div class="stat-pair stat-blank"></div>`;
}

function statRow(items: string[]): string {
  return `<div class="stats-row">\n    ${items.join("\n")}\n  </div>`;
}

function renderStats(stats: SessionStats | undefined): string {
  if (!stats) return "";

  const rows: string[] = [];

  rows.push(
    statRow([
      statPair("Created", formatTimestamp(stats.createdMs)),
      statPair("Updated", formatTimestamp(stats.updatedMs)),
      statBlank(),
    ]),
  );

  rows.push(
    statRow([
      statPair("Tokens input", formatTokens(stats.tokensInput)),
      statPair("Tokens output", formatTokens(stats.tokensOutput)),
      statPair("Cache read", formatTokens(stats.tokensCacheRead)),
    ]),
  );

  rows.push(
    statRow([
      statPair("Tokens reasoning", formatTokens(stats.tokensReasoning)),
      statPair("Reasoning parts", formatTokens(stats.reasoningParts)),
      statPair("Tool-call parts", formatTokens(stats.toolParts)),
    ]),
  );

  rows.push(
    statRow([
      statPair("User messages", formatTokens(stats.userMessages)),
      statPair("Assistant messages", formatTokens(stats.assistantMessages)),
      statPair("Total messages", formatTokens(stats.totalMessages)),
    ]),
  );

  return `<section class="container session-stats">
  <h2 class="session-stats-heading">Session statistics</h2>
  <div class="stats-grid">
    ${rows.join("\n")}
  </div>
</section>`;
}

function buildPage(meta: SessionMeta, turns: Turn[]): string {
  const title = escapeHtml(meta.title);
  const subtitle = [
    meta.sessionId,
    meta.created,
    formatDuration(meta.stats?.durationMs),
    formatCost(meta.stats?.cost),
  ]
    .filter(Boolean)
    .join(" · ");

  const turnHtml = turns
    .map((turn, index) => {
      if (turn.role === "user") {
        return renderUserTurn(turn, index);
      }
      return renderAssistantTurn(turn, index);
    })
    .join("\n");

  const statsHtml = renderStats(meta.stats);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="icon" type="image/svg+xml" href="${generateFavicon(meta.title)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700;1,9..40,400&family=Geist+Mono:wght@400;500&family=League+Spartan:wght@600;700&display=swap">
<style>
${styles()}
</style>
</head>
<body>
<header class="site-header">
  <div class="container">
    <div class="header-content">
      <div>
        <h1 class="session-title">${title}</h1>
        <p class="session-meta">${escapeHtml(subtitle)}</p>
      </div>
      <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">
        <span class="theme-icon-light">☀</span>
        <span class="theme-icon-dark">☾</span>
      </button>
    </div>
  </div>
</header>
<main class="container chat">
${turnHtml}
</main>
${statsHtml}
<script>
${scripts()}
</script>
</body>
</html>`;
}

function renderUserTurn(turn: Turn, index: number): string {
  const messageBlock = turn.content.trim()
    ? `<div class="message user-message">\n    ${md.render(turn.content)}\n  </div>`
    : "";

  let syntheticBlock = "";
  if (turn.synthetic.length > 0) {
    const body = turn.synthetic
      .map(
        (text) =>
          `<pre class="synthetic-code"><code>${escapeHtml(text)}</code></pre>`,
      )
      .join("\n");
    syntheticBlock = `
<details class="collapsible synthetic">
  <summary>Injected context (${turn.synthetic.length})</summary>
  ${body}
</details>`;
  }

  return `
<article class="turn user-turn" id="turn-${index}">
  <div class="turn-header">
    <div class="turn-badge user-badge">User</div>
  </div>
  ${messageBlock}
  ${syntheticBlock}
</article>`;
}

function renderAssistantTurn(turn: Turn, index: number): string {
  const parts: string[] = [];

  if (turn.thinking.length > 0) {
    const thinkingBody = turn.thinking
      .map((t) => `<div class="thinking-block">${md.render(t)}</div>`)
      .join("\n");
    parts.push(`
<details class="collapsible thinking">
  <summary>Thinking (${turn.thinking.length})</summary>
  ${thinkingBody}
</details>`);
  }

  if (turn.tools.length > 0) {
    const toolsBody = turn.tools
      .map((tool) => {
        return `
<details class="collapsible tool">
  <summary><span class="tool-name">${escapeHtml(tool.name)}</span></summary>
  <div class="tool-section">
    <strong>Input</strong>
    <pre class="tool-code"><code>${escapeHtml(tool.input)}</code></pre>
  </div>
  <div class="tool-section">
    <strong>Output</strong>
    <div class="tool-output">${md.render(tool.output)}</div>
  </div>
</details>`;
      })
      .join("\n");
    parts.push(`
<details class="collapsible tools">
  <summary>Tool calls (${turn.tools.length})</summary>
  ${toolsBody}
</details>`);
  }

  const content = turn.content ? md.render(turn.content) : "";
  const messageBlock = content
    ? `<div class="message assistant-message">\n    ${content}\n  </div>`
    : "";

  return `
<article class="turn assistant-turn" id="turn-${index}">
  <div class="turn-header">
    <div class="turn-badge assistant-badge">Assistant</div>
    ${turn.header ? `<div class="assistant-info">${escapeHtml(turn.header)}</div>` : ""}
  </div>
  ${parts.join("\n")}
  ${messageBlock}
</article>`;
}

function styles(): string {
  return `
:root {
  --font-body: "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  --font-heading: "League Spartan", "DM Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --accent: #62748e;
  --accent-dark: #45556c;
  --accent-light: #90a1b9;
  --bg: #f1f5f9;
  --surface: #ffffff;
  --text: #0f172b;
  --text-secondary: #62748e;
  --border: #e2e8f0;
  --border-strong: #cad5e2;
  --code-bg: #e2e8f0;
  --user-accent: #62748e;
  --user-bg: #f8fafc;
  --assistant-accent: #0f172b;
  --assistant-bg: #ffffff;
  --badge-user-text: #ffffff;
  --badge-assistant-text: #ffffff;
  --shadow: 0 1px 2px rgba(15, 23, 43, 0.06), 0 4px 12px rgba(15, 23, 43, 0.04);
}

html.dark {
  --accent: #90a1b9;
  --accent-dark: #cad5e2;
  --accent-light: #e2e8f0;
  --bg: #0f172b;
  --surface: #1d293d;
  --text: #f8fafc;
  --text-secondary: #90a1b9;
  --border: #314158;
  --border-strong: #45556c;
  --code-bg: #020618;
  --user-accent: #90a1b9;
  --user-bg: #314158;
  --assistant-accent: #f1f5f9;
  --assistant-bg: #1d293d;
  --badge-user-text: #0f172b;
  --badge-assistant-text: #0f172b;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 4px 14px rgba(0, 0, 0, 0.3);
}

* {
  box-sizing: border-box;
}

html {
  font-size: 16px;
}

body {
  margin: 0;
  font-family: var(--font-body);
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
  transition: background 0.2s ease, color 0.2s ease;
}

.container {
  max-width: 900px;
  margin: 0 auto;
  padding: 0 1rem;
}

.site-header {
  position: sticky;
  top: 0;
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  backdrop-filter: saturate(1.4) blur(10px);
  -webkit-backdrop-filter: saturate(1.4) blur(10px);
  border-bottom: 1px solid var(--border-strong);
  padding: 1rem 0;
  z-index: 10;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.session-title {
  margin: 0;
  font-family: var(--font-heading);
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
}

.session-meta {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.theme-toggle {
  background: var(--bg);
  border: 1px solid var(--border-strong);
  border-radius: 9999px;
  width: 2.5rem;
  height: 2.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text);
  font-size: 1.1rem;
  transition: background 0.2s ease, border-color 0.2s ease;
}

.theme-toggle:hover {
  background: var(--border);
}

html:not(.dark) .theme-icon-dark {
  display: none;
}

html.dark .theme-icon-light {
  display: none;
}

.chat {
  padding-top: 2rem;
  padding-bottom: 4rem;
}

.turn {
  margin-bottom: 2.5rem;
}

.turn-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  margin-bottom: 0.75rem;
}

.turn-badge {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 0.25rem 0.6rem;
  border-radius: 0.4rem;
  line-height: 1.4;
}

.user-badge {
  color: var(--badge-user-text);
  background: var(--user-accent);
}

.assistant-badge {
  color: var(--badge-assistant-text);
  background: var(--assistant-accent);
}

.assistant-info {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.message {
  padding: 1.25rem 1.5rem;
  border-radius: 0.75rem;
  border: 1px solid var(--border);
  overflow-wrap: break-word;
}

.user-message {
  background: var(--user-bg);
  border-color: color-mix(in srgb, var(--user-accent) 22%, var(--border));
  border-left: 3px solid var(--user-accent);
}

.assistant-message {
  background: var(--assistant-bg);
  box-shadow: var(--shadow);
}

.message > *:first-child {
  margin-top: 0;
}

.message > *:last-child {
  margin-bottom: 0;
}

.collapsible {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 0.5rem;
  margin-bottom: 0.75rem;
  overflow: hidden;
}

.collapsible summary {
  padding: 0.6rem 0.75rem;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  list-style: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.collapsible summary::-webkit-details-marker {
  display: none;
}

.collapsible summary::after {
  content: "+";
  font-size: 1.1rem;
  color: var(--accent);
}

.collapsible[open] summary::after {
  content: "−";
}

.collapsible > *:not(summary) {
  padding: 0 0.75rem 0.75rem;
}

.thinking {
  background: var(--bg);
  border-style: dashed;
}

.thinking-block {
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.session-stats {
  background: var(--bg);
  border: 1px dashed var(--border-strong);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-top: 1rem;
  margin-bottom: 4rem;
}

.session-stats-heading {
  margin: 0 0 1rem;
  font-family: var(--font-heading);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.stats-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.stats-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem 1.5rem;
}

.stat-pair {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.9rem;
}

.stat-blank {
  visibility: hidden;
}

.stat-pair dt {
  color: var(--text-secondary);
  font-weight: 500;
}

.stat-pair dd {
  margin: 0;
  color: var(--text);
  font-family: var(--font-mono);
  font-weight: 500;
}

.stat-na {
  color: var(--text-secondary);
  font-style: italic;
  font-weight: 400;
}

.tool {
  border-left: 3px solid var(--accent);
}

.synthetic {
  border-left: 3px solid var(--user-accent);
  margin-top: 0.75rem;
}

.synthetic-code {
  margin: 0 0 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  line-height: 1.5;
  padding: 0.75rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  overflow-x: auto;
  max-height: 40vh;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-secondary);
}

.synthetic-code:last-child {
  margin-bottom: 0;
}

.tool-name {
  font-family: var(--font-mono);
  color: var(--text);
}

.tool-section {
  margin-bottom: 0.75rem;
}

.tool-section strong {
  display: block;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin-bottom: 0.25rem;
}

.tool-code {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  padding: 0.75rem;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  overflow-x: auto;
  font-size: 0.85rem;
  line-height: 1.5;
}

.tool-output {
  max-height: 40vh;
  overflow-y: auto;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  font-size: 0.9rem;
}

.tool-output pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-output img {
  max-width: 100%;
  height: auto;
  border-radius: 0.25rem;
}

.message h1,
.message h2,
.message h3,
.message h4,
.message h5,
.message h6 {
  font-family: var(--font-heading);
  margin: 1.5rem 0 0.75rem;
  line-height: 1.2;
  font-weight: 700;
  color: var(--text);
}

.message h1 {
  font-size: 1.6rem;
  border-bottom: 2px solid var(--border-strong);
  padding-bottom: 0.5rem;
}

.message h2 {
  font-size: 1.3rem;
  border-bottom: 1px solid var(--border-strong);
  padding-bottom: 0.4rem;
}

.message h3 {
  font-size: 1.1rem;
}

.message p {
  margin: 0.75rem 0;
}

.message a {
  color: var(--accent-dark);
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, var(--accent) 40%, transparent);
  text-underline-offset: 2px;
  font-weight: 500;
}

.message a:hover {
  text-decoration-color: var(--accent);
}

.message ul,
.message ol {
  margin: 0.75rem 0;
  padding-left: 1.5rem;
}

.message li {
  margin: 0.25rem 0;
}

.message blockquote {
  margin: 0.75rem 0;
  padding: 0.5rem 1rem;
  border-left: 4px solid var(--accent);
  background: var(--bg);
  color: var(--text-secondary);
}

.message pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  padding: 0.75rem;
  overflow-x: auto;
  margin: 0.75rem 0;
}

.message pre code {
  font-family: var(--font-mono);
  font-size: 0.85rem;
  line-height: 1.5;
  background: transparent;
  padding: 0;
  border-radius: 0;
}

.message code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--code-bg);
  padding: 0.15rem 0.35rem;
  border-radius: 0.25rem;
}

.message table {
  width: 100%;
  border-collapse: collapse;
  margin: 0.75rem 0;
  font-size: 0.9rem;
  overflow-x: auto;
  display: block;
}

.message thead {
  background: var(--bg);
}

.message th,
.message td {
  border: 1px solid var(--border);
  padding: 0.5rem 0.75rem;
  text-align: left;
  vertical-align: top;
}

.message th {
  font-weight: 600;
  color: var(--text);
}

.message img {
  max-width: 100%;
  height: auto;
  border-radius: 0.5rem;
  margin: 0.5rem 0;
}

.message hr {
  border: none;
  border-top: 1px solid var(--border);
  margin: 1.5rem 0;
}

@media (max-width: 640px) {
  html {
    font-size: 15px;
  }

  .container {
    padding: 0 0.75rem;
  }

  .session-title {
    font-size: 1.1rem;
  }

  .session-meta {
    font-size: 0.75rem;
  }

  .message {
    padding: 1rem 1.1rem;
  }

  .turn {
    margin-bottom: 2rem;
  }

  .turn-header {
    flex-wrap: wrap;
  }

  .stats-row {
    grid-template-columns: 1fr;
  }
}
`;
}

function scripts(): string {
  return `
(function() {
  const toggle = document.getElementById('theme-toggle');
  const root = document.documentElement;
  const stored = localStorage.getItem('opencode-theme');
  if (stored === 'dark') {
    root.classList.add('dark');
  }

  toggle.addEventListener('click', function() {
    const isDark = root.classList.toggle('dark');
    localStorage.setItem('opencode-theme', isDark ? 'dark' : 'light');
  });
})();
`;
}

function resolveOutputPath(inputPath: string): string {
  const ext = path.extname(inputPath);
  const outputName = path.basename(inputPath, ext) + ".html";
  return path.join(path.dirname(inputPath), outputName);
}

export function renderFile(inputPath: string, options: RenderOptions = {}): string {
  const { sanitize = true } = options;
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    const display = sanitize ? sanitizePathForDisplay(resolved) : resolved;
    throw new Error(`File not found: ${display}`);
  }

  const text = fs.readFileSync(resolved, "utf-8");
  const parsed = JSON.parse(text) as unknown;
  let { meta, turns } = extractSession(parsed);

  if (sanitize) {
    sanitizeSession(meta, turns);
  }

  const html = buildPage(meta, turns);
  const outputPath = options.outputPath
    ? path.resolve(options.outputPath)
    : resolveOutputPath(resolved);

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, html, "utf-8");

  const displayResolved = sanitize ? sanitizePathForDisplay(resolved) : resolved;
  const displayOutput = sanitize ? sanitizePathForDisplay(outputPath) : outputPath;
  console.log(`Rendered ${turns.length} turns from ${displayResolved} → ${displayOutput}`);
  return outputPath;
}

export function renderFiles(inputPaths: string[], options: RenderOptions = {}): void {
  for (const inputPath of inputPaths) {
    renderFile(inputPath, options);
  }
}
