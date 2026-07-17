#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

interface SessionMeta {
  title: string;
  sessionId?: string;
  created?: string;
  updated?: string;
}

interface ToolCall {
  name: string;
  input: string;
  output: string;
}

interface Turn {
  role: "user" | "assistant";
  header?: string;
  thinking: string[];
  tools: ToolCall[];
  content: string;
  synthetic: string[];
}

// JSON export format produced by Opencode.
interface JsonSession {
  info: JsonSessionInfo;
  messages: JsonMessage[];
}

interface JsonSessionInfo {
  id: string;
  title: string;
  agent?: string;
  model?: { id?: string; providerID?: string };
  version?: string;
  cost?: number;
  time?: { created?: number; updated?: number };
}

interface JsonMessage {
  info: JsonMessageInfo;
  parts: JsonPart[];
}

interface JsonMessageInfo {
  id: string;
  sessionID: string;
  parentID?: string;
  role: "user" | "assistant";
  agent?: string;
  modelID?: string;
  providerID?: string;
  mode?: string;
  cost?: number;
  time?: { created?: number; completed?: number };
  finish?: string;
}

interface JsonPart {
  type: string;
  text?: string;
  synthetic?: boolean;
  tool?: string;
  callID?: string;
  state?: JsonToolState;
}

interface JsonToolState {
  status?: string;
  input?: Record<string, unknown>;
  output?: string;
  metadata?: { truncated?: boolean; outputPath?: string };
  title?: string;
  time?: { start?: number; end?: number };
}

function parseSession(text: string): { meta: SessionMeta; turns: Turn[] } {
  const lines = text.split("\n");
  let title = "Chat Session";
  const meta: SessionMeta = { title };

  // First pass: extract title and metadata from the top of the file.
  let metaEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      meta.title = title;
      continue;
    }
    const sessionMatch = /^\*\*Session ID:\*\*\s*(.+)$/.exec(line);
    if (sessionMatch) {
      meta.sessionId = sessionMatch[1]!.trim();
      continue;
    }
    const createdMatch = /^\*\*Created:\*\*\s*(.+)$/.exec(line);
    if (createdMatch) {
      meta.created = createdMatch[1]!.trim();
      continue;
    }
    const updatedMatch = /^\*\*Updated:\*\*\s*(.+)$/.exec(line);
    if (updatedMatch) {
      meta.updated = updatedMatch[1]!.trim();
      continue;
    }
    if (line.startsWith("---")) {
      metaEnd = i;
      break;
    }
  }

  // Split the remainder into turns on standalone "---" lines.
  const remainder = lines.slice(metaEnd).join("\n");
  const turnBlocks = remainder
    .split(/^---\s*$/gm)
    .map((b) => b.trim())
    .filter((b) => b.length > 0);

  const turns: Turn[] = [];

  for (const block of turnBlocks) {
    const lines = block.split("\n");
    const firstLine = lines[0]!;

    if (firstLine.startsWith("## User")) {
      const content = lines.slice(1).join("\n").trim();
      turns.push({ role: "user", thinking: [], tools: [], content, synthetic: [] });
      continue;
    }

    if (firstLine.startsWith("## Assistant")) {
      const header = firstLine.slice(3).trim();
      const body = lines.slice(1).join("\n");
      turns.push(parseAssistantTurn(header, body));
      continue;
    }

    // If the block doesn't start with a recognized header, treat it as an
    // assistant content block. This handles stray content gracefully.
    turns.push({
      role: "assistant",
      thinking: [],
      tools: [],
      content: block,
      synthetic: [],
    });
  }

  return { meta, turns };
}

function formatTimestamp(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  return new Date(ms).toLocaleString();
}

function parseJsonSession(session: JsonSession): { meta: SessionMeta; turns: Turn[] } {
  const info = session.info;
  const meta: SessionMeta = {
    title: info.title || "Chat Session",
    sessionId: info.id,
    created: formatTimestamp(info.time?.created),
    updated: formatTimestamp(info.time?.updated),
  };

  const turns: Turn[] = [];
  const assistantBuckets = new Map<string, Turn>();

  for (const message of session.messages) {
    const role = message.info.role;

    if (role === "user") {
      turns.push({
        role: "user",
        thinking: [],
        tools: [],
        content: collectTextParts(message.parts, false),
        synthetic: collectSyntheticParts(message.parts),
      });
      continue;
    }

    // Assistant messages are grouped by parentID so a multi-step response
    // renders as a single assistant turn.
    const parentID = message.info.parentID || "orphan";
    let turn = assistantBuckets.get(parentID);
    if (!turn) {
      turn = {
        role: "assistant",
        header: buildAssistantHeader(message.info),
        thinking: [],
        tools: [],
        content: "",
        synthetic: [],
      };
      assistantBuckets.set(parentID, turn);
      turns.push(turn);
    }

    for (const part of message.parts) {
      switch (part.type) {
        case "text":
          if (part.text) {
            turn.content = joinContent(turn.content, part.text);
          }
          break;
        case "reasoning":
          if (part.text) {
            turn.thinking.push(part.text);
          }
          break;
        case "tool":
          if (part.tool && part.state) {
            turn.tools.push(parseJsonTool(part.tool, part.state));
          }
          break;
        case "step-start":
        case "step-finish":
          // metadata wrappers; ignore for rendering
          break;
        default:
          // Unknown part types are skipped.
          break;
      }
    }
  }

  return { meta, turns };
}

function collectTextParts(parts: JsonPart[], includeSynthetic = true): string {
  return parts
    .filter((p) => p.type === "text" && p.text && (includeSynthetic || !p.synthetic))
    .map((p) => p.text!)
    .join("\n\n");
}

function collectSyntheticParts(parts: JsonPart[]): string[] {
  return parts
    .filter((p) => p.type === "text" && p.text && p.synthetic)
    .map((p) => p.text!);
}

function joinContent(existing: string, addition: string): string {
  existing = existing.trim();
  addition = addition.trim();
  if (!existing) return addition;
  if (!addition) return existing;
  return `${existing}\n\n${addition}`;
}

function buildAssistantHeader(info: JsonMessageInfo): string | undefined {
  const bits: string[] = [];
  if (info.mode) bits.push(info.mode);
  if (info.modelID) {
    const modelLabel = info.providerID
      ? `${info.providerID}/${info.modelID}`
      : info.modelID;
    bits.push(modelLabel);
  }
  if (info.time?.created && info.time?.completed) {
    const durationMs = info.time.completed - info.time.created;
    if (durationMs >= 0) {
      bits.push(`${(durationMs / 1000).toFixed(1)}s`);
    }
  }
  return bits.length > 0 ? bits.join(" · ") : undefined;
}

function parseJsonTool(toolName: string, state: JsonToolState): ToolCall {
  const input = state.input
    ? JSON.stringify(state.input, null, 2)
    : "";
  let output = state.output || "";
  if (state.metadata?.truncated) {
    output = output.trimEnd();
  }
  return { name: toolName, input, output };
}

function parseAssistantTurn(header: string, body: string): Turn {
  const turn: Turn = {
    role: "assistant",
    header,
    thinking: [],
    tools: [],
    content: "",
    synthetic: [],
  };

  let remaining = body.trimStart();

  // Extract thinking block if present. It starts with "_Thinking:_" and ends
  // just before the first "**Tool:" marker.
  if (remaining.startsWith("_Thinking:_")) {
    const toolMarker = "**Tool:";
    const toolIndex = remaining.indexOf(toolMarker);
    if (toolIndex !== -1) {
      const thinkingText = remaining
        .slice(0, toolIndex)
        .replace(/^_Thinking:_\s*/, "")
        .trim();
      if (thinkingText) turn.thinking.push(thinkingText);
      remaining = remaining.slice(toolIndex);
    } else {
      // No tools: strip the marker and treat the rest as the answer.
      remaining = remaining.replace(/^_Thinking:_\s*/, "");
    }
  }

  // Extract tool blocks.
  const toolBlocks = splitByToolMarkers(remaining);
  if (toolBlocks.length === 0) {
    turn.content = remaining.trim();
    return turn;
  }

  let contentStart = remaining.length;
  for (const block of toolBlocks) {
    const tool = parseToolBlock(block.text);
    if (tool) {
      turn.tools.push(tool);
      contentStart = block.start + block.consumedLength;
    }
  }

  turn.content = remaining.slice(contentStart).trim();

  return turn;
}

interface ToolBlock {
  text: string;
  start: number;
  consumedLength: number;
}

function splitByToolMarkers(text: string): ToolBlock[] {
  const marker = "**Tool:";
  const positions: number[] = [];
  let idx = 0;
  while (true) {
    const pos = text.indexOf(marker, idx);
    if (pos === -1) break;
    positions.push(pos);
    idx = pos + marker.length;
  }

  const blocks: ToolBlock[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i]!;
    const end = i + 1 < positions.length ? positions[i + 1]! : text.length;
    blocks.push({
      text: text.slice(start, end),
      start,
      consumedLength: end - start,
    });
  }
  return blocks;
}

function parseToolBlock(text: string): ToolCall | null {
  const nameMatch = /^\*\*Tool:\s*([^*]+)\*\*/.exec(text);
  if (!nameMatch) return null;
  const name = nameMatch[1]!.trim();

  const inputLabel = "**Input:**";
  const outputLabel = "**Output:**";
  const inputIndex = text.indexOf(inputLabel);
  const outputIndex = text.indexOf(outputLabel);
  if (inputIndex === -1 || outputIndex === -1 || outputIndex <= inputIndex) {
    return null;
  }

  const input = text
    .slice(inputIndex + inputLabel.length, outputIndex)
    .trim();
  const outputRaw = text.slice(outputIndex + outputLabel.length);
  const output = extractFencedContent(outputRaw).trim();

  return { name, input, output };
}

function extractFencedContent(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const firstNewline = trimmed.indexOf("\n");
    if (firstNewline !== -1) {
      const rest = trimmed.slice(firstNewline + 1);
      const endFence = rest.lastIndexOf("```");
      if (endFence !== -1) {
        return rest.slice(0, endFence).trimEnd();
      }
    }
  }
  return trimmed;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildPage(meta: SessionMeta, turns: Turn[]): string {
  const title = escapeHtml(meta.title);
  const subtitle = [meta.sessionId, meta.created, meta.updated]
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

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
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
      .map((tool, tidx) => {
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

type SourceFormat = "json" | "markdown" | "unknown";

function getSourceFormat(inputPath: string): SourceFormat {
  const ext = path.extname(inputPath).toLowerCase();
  if (ext === ".json") return "json";
  if (ext === ".md" || ext === ".markdown") return "markdown";
  return "unknown";
}

function resolveOutputPath(inputPath: string): string {
  const ext = path.extname(inputPath);
  const outputName = path.basename(inputPath, ext) + ".html";
  return path.join(path.dirname(inputPath), outputName);
}

function processFile(inputPath: string, format: SourceFormat): void {
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    console.error(`File not found: ${resolved}`);
    process.exit(1);
  }

  const text = fs.readFileSync(resolved, "utf-8");
  let meta: SessionMeta;
  let turns: Turn[];

  if (format === "json") {
    const session = JSON.parse(text) as JsonSession;
    ({ meta, turns } = parseJsonSession(session));
  } else {
    console.log(
      `warning: Markdown export format is fragile (tool blocks can break on headings or images). Use the JSON export format for reliable rendering.`,
    );
    ({ meta, turns } = parseSession(text));
  }

  const html = buildPage(meta, turns);
  const outputPath = resolveOutputPath(resolved);
  fs.writeFileSync(outputPath, html, "utf-8");

  console.log(`Rendered ${turns.length} turns from ${resolved} → ${outputPath}`);
}

function main(): void {
  const inputs = process.argv.slice(2);
  if (inputs.length === 0) {
    console.error(
      "Usage: bun render.ts <session.json|session.md> [<session2.json|session2.md> ...]",
    );
    process.exit(1);
  }

  // JSON inputs win silently over Markdown inputs that target the same output.
  const outputToFormat = new Map<string, { input: string; format: SourceFormat }>();
  for (const input of inputs) {
    const format = getSourceFormat(input);
    if (format === "unknown") {
      console.error(`Unsupported file format: ${input}`);
      process.exit(1);
    }
    const outputPath = resolveOutputPath(path.resolve(input));
    const existing = outputToFormat.get(outputPath);
    if (existing && existing.format === "json") {
      // JSON already owns this output; ignore the Markdown input.
      continue;
    }
    outputToFormat.set(outputPath, { input, format });
  }

  for (const { input, format } of outputToFormat.values()) {
    processFile(input, format);
  }
}

main();
