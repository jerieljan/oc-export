import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import { sanitizePathForDisplay, sanitizeText } from "./sanitize.js";
import { extractSession } from "./extractors/index.js";
import { summarizeSession, summarizeTurns, type SummarizeOptions } from "./summarize.js";
import type { NavigationConfig } from "./config.js";
import {
  formatCost,
  formatDuration,
  formatTimestamp,
  formatTimestampIsoWithTimezone,
  formatTokens,
} from "./format.js";
import type { Reference, SessionMeta, SessionStats, SubagentLink, ToolCall, Turn } from "./types.js";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

export interface RenderOptions {
  sanitize?: boolean;
  outputPath?: string;
  summarize?: SummarizeOptions;
  username?: string;
  navigation?: NavigationConfig;
  parentOutputPath?: string;
  parentTitle?: string;
  totalCost?: number;
}

function sanitizeSession(meta: SessionMeta, turns: Turn[]): void {
  meta.title = sanitizeText(meta.title);
  meta.sessionId = meta.sessionId ? sanitizeText(meta.sessionId) : undefined;
  meta.parentSessionId = meta.parentSessionId
    ? sanitizeText(meta.parentSessionId)
    : undefined;
  meta.created = meta.created ? sanitizeText(meta.created) : undefined;
  meta.updated = meta.updated ? sanitizeText(meta.updated) : undefined;
  meta.sessionSummary = meta.sessionSummary
    ? sanitizeText(meta.sessionSummary)
    : undefined;

  if (meta.subagents) {
    for (const sub of meta.subagents) {
      sub.sessionId = sanitizeText(sub.sessionId);
      sub.title = sub.title ? sanitizeText(sub.title) : undefined;
      sub.description = sub.description
        ? sanitizeText(sub.description)
        : undefined;
    }
  }

  for (const turn of turns) {
    turn.content = sanitizeText(turn.content);
    turn.header = turn.header ? sanitizeText(turn.header) : undefined;
    turn.thinking = turn.thinking.map(sanitizeText);
    turn.synthetic = turn.synthetic.map(sanitizeText);
    turn.thinkingSummary = turn.thinkingSummary
      ? sanitizeText(turn.thinkingSummary)
      : undefined;
    turn.toolsSummary = turn.toolsSummary
      ? sanitizeText(turn.toolsSummary)
      : undefined;

    for (const tool of turn.tools) {
      tool.name = sanitizeText(tool.name);
      tool.input = sanitizeText(tool.input);
      tool.output = sanitizeText(tool.output);
      if (tool.subagent) {
        tool.subagent.sessionId = sanitizeText(tool.subagent.sessionId);
        tool.subagent.title = tool.subagent.title
          ? sanitizeText(tool.subagent.title)
          : undefined;
        tool.subagent.description = tool.subagent.description
          ? sanitizeText(tool.subagent.description)
          : undefined;
        tool.subagent.state = tool.subagent.state
          ? sanitizeText(tool.subagent.state)
          : undefined;
      }
    }

    if (turn.references) {
      for (const ref of turn.references) {
        ref.title = sanitizeText(ref.title);
        ref.domain = ref.domain ? sanitizeText(ref.domain) : undefined;
        ref.snippet = ref.snippet ? sanitizeText(ref.snippet) : undefined;
      }
    }
  }
}

function last8(id: string): string {
  return id.slice(-8);
}

function sessionHtmlPath(sessionId: string): string {
  return `./session-${last8(sessionId)}.html`;
}

function formatCostWithTotal(
  cost: number | undefined,
  totalCost: number | undefined,
): string | undefined {
  const parent = formatCost(cost);
  const total = formatCost(totalCost);
  if (!parent) return total;
  if (!total || total === parent) return parent;
  return `${parent} (${total} total)`;
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

function statPair(
  label: string,
  value: string | undefined,
  title?: string,
): string {
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  const valueHtml =
    value === undefined
      ? `<dd class="stat-na">N/A</dd>`
      : `<dd${titleAttr}>${escapeHtml(value)}</dd>`;
  return `<div class="stat-pair"><dt>${escapeHtml(label)}</dt>${valueHtml}</div>`;
}

function statBlank(): string {
  return `<div class="stat-pair stat-blank"></div>`;
}

function statRow(items: string[]): string {
  return `<div class="stats-row">\n    ${items.join("\n")}\n  </div>`;
}

function renderStats(meta: SessionMeta): string {
  const stats = meta.stats;
  const sessionId = meta.sessionId;

  if (!stats && !sessionId) return "";

  const rows: string[] = [];

  if (stats) {
    rows.push(
      statRow([
        statPair(
          "Created",
          formatTimestamp(stats.createdMs),
          formatTimestampIsoWithTimezone(stats.createdMs),
        ),
        statPair(
          "Updated",
          formatTimestamp(stats.updatedMs),
          formatTimestampIsoWithTimezone(stats.updatedMs),
        ),
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
  }

  const idHtml = sessionId
    ? `<span class="session-id"> - ${escapeHtml(sessionId)}</span>`
    : "";

  return `<section class="container session-stats">
  <h2 class="session-stats-heading">Session statistics${idHtml}</h2>
  ${stats ? `<div class="stats-grid">
    ${rows.join("\n")}
  </div>` : ""}
</section>`;
}

function renderSessionSummary(summary: string): string {
  return `<section class="container session-summary">
  <h2 class="session-summary-heading">Session summary</h2>
  <div class="session-summary-body">
    ${md.render(summary)}
  </div>
</section>`;
}

function renderParentLink(parentSessionId: string, parentTitle?: string, parentOutputPath?: string): string {
  const href = escapeHtml(parentOutputPath ?? sessionHtmlPath(parentSessionId));
  const text = parentTitle ? parentTitle : parentSessionId.slice(-8);
  return `
<div class="parent-link">
  <a href="${href}">← Parent session: ${escapeHtml(text)}</a>
</div>`;
}

function renderSubagentRelations(subagents: SubagentLink[]): string {
  if (subagents.length === 0) return "";
  const items = subagents
    .map((sub) => {
      const title = sub.title || sub.sessionId.slice(-8);
      const description = sub.description
        ? `<p class="subagent-relation-description">${escapeHtml(sub.description)}</p>`
        : "";
      return `
      <li>
        <a href="${escapeHtml(sessionHtmlPath(sub.sessionId))}">${escapeHtml(title)}</a>
        ${description}
      </li>`;
    })
    .join("\n");

  return `
<section class="container subagent-relations">
  <h2 class="subagent-relations-heading">Subagent sessions</h2>
  <ol class="subagent-relations-list">
    ${items}
  </ol>
</section>`;
}

function renderTurnScrubber(
  turns: Turn[],
  navigation?: NavigationConfig,
): string {
  const nav = {
    enabled: navigation?.enabled ?? true,
    minTurns: navigation?.minTurns ?? 0,
    progressBar: navigation?.progressBar ?? true,
    roleColor: navigation?.roleColor ?? false,
  };

  if (!nav.enabled || turns.length < nav.minTurns) {
    return "";
  }

  const progressHtml = nav.progressBar
    ? `<div class="turn-scrubber-progress" id="turn-scrubber-progress"></div>`
    : "";

  const links = turns
    .map((turn, index) => {
      const roleClass = turn.role === "user" ? "role-user" : "role-assistant";
      const classes = nav.roleColor
        ? `turn-scrubber-link ${roleClass}`
        : "turn-scrubber-link";
      return `<a href="#turn-${index}" class="${classes}" data-turn="${index}" title="Turn ${index + 1}">${index + 1}</a>`;
    })
    .join("\n");

  return `
<nav class="turn-scrubber" aria-label="Turn navigation">
  <div class="turn-scrubber-track">
    ${links}
  </div>
  ${progressHtml}
</nav>`;
}

function buildPage(
  meta: SessionMeta,
  turns: Turn[],
  username?: string,
  navigation?: NavigationConfig,
  parentOutputPath?: string,
  parentTitle?: string,
): string {
  const title = escapeHtml(meta.title);
  const created = meta.created ?? formatTimestamp(meta.stats?.createdMs);
  const createdIso = formatTimestampIsoWithTimezone(meta.stats?.createdMs);
  const createdHtml = created
    ? createdIso
      ? `<span title="${escapeHtml(createdIso)}">${escapeHtml(created)}</span>`
      : escapeHtml(created)
    : "";
  const subtitle = [createdHtml, formatDuration(meta.stats?.durationMs), formatCostWithTotal(meta.stats?.cost, meta.stats?.totalCost)]
    .filter(Boolean)
    .join(" - ");

  const turnHtml = turns
    .map((turn, index) => {
      if (turn.role === "user") {
        return renderUserTurn(turn, index, username);
      }
      return renderAssistantTurn(turn, index);
    })
    .join("\n");

  const statsHtml = renderStats(meta);
  const sessionSummaryHtml = meta.sessionSummary
    ? renderSessionSummary(meta.sessionSummary)
    : "";
  const parentLinkHtml = meta.parentSessionId
    ? renderParentLink(meta.parentSessionId, parentTitle, parentOutputPath)
    : "";
  const subagentRelationsHtml = meta.subagents && meta.subagents.length > 0
    ? renderSubagentRelations(meta.subagents)
    : "";
  const navConfig = {
    enabled: navigation?.enabled ?? true,
    minTurns: navigation?.minTurns ?? 0,
    progressBar: navigation?.progressBar ?? true,
    roleColor: navigation?.roleColor ?? false,
  };
  const navHtml = renderTurnScrubber(turns, navConfig);
  const activeNav = navHtml !== "" ? navConfig : undefined;

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
${styles(activeNav)}
</style>
</head>
<body>
<header class="site-header">
  <div class="container">
    <div class="header-content">
      <div>
        ${parentLinkHtml}
        <h1 class="session-title">${title}</h1>
        <p class="session-meta">${subtitle}</p>
      </div>
      <div class="header-actions">
        <button class="download-toggle" id="download-toggle" aria-label="Download this page">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        <button class="theme-toggle" id="theme-toggle" aria-label="Toggle dark mode">
          <span class="theme-icon-light">☀</span>
          <span class="theme-icon-dark">☾</span>
        </button>
      </div>
    </div>
  </div>
</header>
${sessionSummaryHtml}
${subagentRelationsHtml}
<main class="container chat">
${turnHtml}
</main>
${statsHtml}
${navHtml}
<script>
${scripts(activeNav)}
</script>
</body>
</html>`;
}

function renderUserTurn(turn: Turn, index: number, username?: string): string {
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

  const badgeLabel = escapeHtml(username ?? "User");

  return `
<article class="turn user-turn" id="turn-${index}">
  <div class="turn-header">
    <div class="turn-badge user-badge">${badgeLabel}</div>
  </div>
  ${messageBlock}
  ${syntheticBlock}
</article>`;
}

function dedupeReferences(refs: Reference[]): {
  byUrl: Map<string, Reference>;
  indexToCanonical: Map<number, Reference>;
} {
  const sorted = [...refs].sort((a, b) => a.index - b.index);
  const byUrl = new Map<string, Reference>();
  for (const ref of sorted) {
    if (!byUrl.has(ref.url)) {
      byUrl.set(ref.url, ref);
    }
  }
  const indexToCanonical = new Map<number, Reference>();
  for (const ref of refs) {
    indexToCanonical.set(ref.index, byUrl.get(ref.url)!);
  }
  return { byUrl, indexToCanonical };
}

function renderContentWithReferences(
  content: string,
  turnIndex: number,
  refs: Reference[],
): string {
  const { indexToCanonical } = dedupeReferences(refs);
  let html = md.render(content);
  html = html.replace(/【(\d+)】/g, (_, numStr) => {
    const num = parseInt(numStr, 10);
    const canonical = indexToCanonical.get(num);
    if (!canonical) return "";
    return `<sup class="ref"><a href="#turn-${turnIndex}-ref-${canonical.index}">${num}</a></sup>`;
  });
  return html;
}

function renderTurnReferences(refs: Reference[], turnIndex: number): string {
  if (refs.length === 0) return "";
  const { byUrl } = dedupeReferences(refs);
  const canonicalRefs = [...byUrl.values()].sort((a, b) => a.index - b.index);

  const items = canonicalRefs
    .map((ref) => {
      const domain = ref.domain
        ? ` <span class="ref-domain">${escapeHtml(ref.domain)}</span>`
        : "";
      const snippet = ref.snippet
        ? `<p class="ref-snippet">${escapeHtml(ref.snippet)}</p>`
        : "";
      return `
      <li id="turn-${turnIndex}-ref-${ref.index}">
        <a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener">${ref.index}. ${escapeHtml(ref.title)}</a>${domain}
        ${snippet}
      </li>`;
    })
    .join("\n");

  return `
<details class="collapsible references">
  <summary>References (${canonicalRefs.length})</summary>
  <ol class="references-list">
    ${items}
  </ol>
</details>`;
}

function renderSubagentTool(tool: ToolCall): string {
  const sub = tool.subagent!;
  const title = sub.title || sub.sessionId.slice(-8);
  const state = sub.state ? `<span class="subagent-state">${escapeHtml(sub.state)}</span>` : "";
  const description = sub.description
    ? `<p class="subagent-description">${escapeHtml(sub.description)}</p>`
    : "";
  const href = escapeHtml(sessionHtmlPath(sub.sessionId));

  return `
<div class="subagent-card">
  <div class="subagent-header">
    <span class="subagent-badge">Subagent</span>
    <span class="subagent-title">${escapeHtml(title)}</span>
    ${state}
  </div>
  <div class="subagent-body">
    ${description}
    <a class="subagent-link" href="${href}">Open subagent session</a>
  </div>
</div>`;
}

function renderAssistantTurn(turn: Turn, index: number): string {
  const parts: string[] = [];

  if (turn.thinking.length > 0) {
    const thinkingBody = turn.thinkingSummary
      ? `<div class="thinking-block">${md.render(turn.thinkingSummary)}</div>`
      : turn.thinking
          .map((t) => `<div class="thinking-block">${md.render(t)}</div>`)
          .join("\n");
    parts.push(`
<details class="collapsible thinking">
  <summary>Thinking (${turn.thinking.length})</summary>
  ${thinkingBody}
</details>`);
  }

  if (turn.tools.length > 0) {
    const subagentTools = turn.tools.filter((tool) => tool.subagent);
    const regularTools = turn.tools.filter((tool) => !tool.subagent);

    if (subagentTools.length > 0) {
      parts.push(subagentTools.map((tool) => renderSubagentTool(tool)).join("\n"));
    }

    if (regularTools.length > 0) {
      const toolsBody = turn.toolsSummary
        ? `<div class="thinking-block">${md.render(turn.toolsSummary)}</div>`
        : regularTools
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
  <summary>Tool calls (${regularTools.length})</summary>
  ${toolsBody}
</details>`);
    }
  }

  const hasReferences = turn.references && turn.references.length > 0;
  const content = turn.content
    ? hasReferences
      ? renderContentWithReferences(turn.content, index, turn.references!)
      : md.render(turn.content)
    : "";
  const messageBlock = content
    ? `<div class="message assistant-message">\n    ${content}\n  </div>`
    : "";

  const referencesBlock = hasReferences
    ? renderTurnReferences(turn.references!, index)
    : "";

  return `
<article class="turn assistant-turn" id="turn-${index}">
  <div class="turn-header">
    <div class="turn-badge assistant-badge">Assistant</div>
    ${turn.header ? `<div class="assistant-info">${escapeHtml(turn.header)}</div>` : ""}
  </div>
  ${parts.join("\n")}
  ${messageBlock}
  ${referencesBlock}
</article>`;
}

function styles(navigation?: NavigationConfig): string {
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
  --nav-user-bg: #0f172b;
  --nav-user-text: #f8fafc;
  --nav-assistant-bg: #e2e8f0;
  --nav-assistant-text: #0f172b;
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
  --nav-user-bg: #020618;
  --nav-user-text: #f8fafc;
  --nav-assistant-bg: #314158;
  --nav-assistant-text: #f8fafc;
}

* {
  box-sizing: border-box;
}

html {
  font-size: 16px;
  scroll-behavior: smooth;
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
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

.theme-toggle,
.download-toggle {
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
  padding: 0;
}

.theme-toggle:hover,
.download-toggle:hover {
  background: var(--border);
}

.download-toggle svg {
  width: 1.15rem;
  height: 1.15rem;
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
  scroll-margin-top: 7.10rem;
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

.session-stats,
.session-summary {
  background: var(--bg);
  border: 1px dashed var(--border-strong);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-top: 1rem;
  margin-bottom: 4rem;
}

.session-summary {
  margin-top: 2rem;
}

.session-stats-heading,
.session-summary-heading {
  margin: 0 0 1rem;
  font-family: var(--font-heading);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.session-summary-body {
  color: var(--text);
  font-size: 0.95rem;
}

.session-summary-body p,
.session-summary-body ul,
.session-summary-body ol {
  margin: 0.75rem 0;
}

.session-summary-body > *:first-child {
  margin-top: 0;
}

.session-summary-body > *:last-child {
  margin-bottom: 0;
}

.session-id {
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.2s ease;
  font-family: var(--font-mono);
  font-weight: 500;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-secondary);
}

.session-stats-heading:hover .session-id {
  opacity: 1;
  visibility: visible;
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

.references {
  border-left: 3px solid var(--accent-light);
  margin-top: 0.75rem;
}

.references-list {
  list-style: none;
  margin: 0;
  padding-left: 0;
  font-size: 0.9rem;
}

.references-list li {
  margin: 0.5rem 0;
  color: var(--text);
}

.ref {
  font-size: 0.75em;
  line-height: 0;
  vertical-align: super;
}

.ref a {
  color: var(--accent-dark);
  text-decoration: none;
  font-weight: 600;
}

.ref a:hover {
  text-decoration: underline;
  text-decoration-color: var(--accent);
}

.ref-domain {
  color: var(--text-secondary);
  font-size: 0.8em;
  font-family: var(--font-mono);
}

.ref-snippet {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
  font-size: 0.85em;
  line-height: 1.5;
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

.parent-link {
  font-size: 0.85rem;
  margin-bottom: 0.4rem;
}

.parent-link a {
  color: var(--accent-dark);
  text-decoration: none;
  font-weight: 500;
}

.parent-link a:hover {
  text-decoration: underline;
  text-decoration-color: var(--accent);
}

.subagent-relations {
  background: var(--bg);
  border: 1px dashed var(--border-strong);
  border-radius: 0.5rem;
  padding: 1rem;
  margin-top: 2rem;
  margin-bottom: 0;
}

.subagent-relations-heading {
  margin: 0 0 1rem;
  font-family: var(--font-heading);
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.subagent-relations-list {
  list-style: none;
  margin: 0;
  padding-left: 0;
  font-size: 0.95rem;
}

.subagent-relations-list li {
  margin: 0.5rem 0;
  color: var(--text);
}

.subagent-relations-list a {
  color: var(--accent-dark);
  text-decoration: none;
  font-weight: 600;
}

.subagent-relations-list a:hover {
  text-decoration: underline;
  text-decoration-color: var(--accent);
}

.subagent-relation-description {
  margin: 0.25rem 0 0;
  color: var(--text-secondary);
  font-size: 0.85em;
  line-height: 1.5;
}

.subagent-card {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--accent-dark);
  border-radius: 0.5rem;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
  box-shadow: var(--shadow);
}

.subagent-header {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
  margin-bottom: 0.5rem;
}

.subagent-badge {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  padding: 0.25rem 0.6rem;
  border-radius: 0.4rem;
  line-height: 1.4;
  color: var(--badge-assistant-text);
  background: var(--accent-dark);
}

.subagent-title {
  font-weight: 600;
  color: var(--text);
}

.subagent-state {
  font-size: 0.8rem;
  color: var(--text-secondary);
  text-transform: capitalize;
}

.subagent-body {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.subagent-description {
  margin: 0 0 0.5rem;
  line-height: 1.5;
}

.subagent-link {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--accent-dark);
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
}

.subagent-link:hover {
  text-decoration: underline;
  text-decoration-color: var(--accent);
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

${navigation ? scrubberStyles(navigation) : ''}
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

function scrubberStyles(navigation: NavigationConfig): string {
  const progressBar = navigation.progressBar ?? true;
  const roleColor = navigation.roleColor ?? false;
  const progressStyles = progressBar
    ? `
.turn-scrubber-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  background: var(--accent);
  width: 0%;
  transition: width 0.3s ease;
  z-index: 21;
}
`
    : "";
  const roleStyles = roleColor
    ? `
.turn-scrubber-link.role-user {
  background: var(--nav-user-bg);
  color: var(--nav-user-text);
}

.turn-scrubber-link.role-user:hover {
  background: color-mix(in srgb, var(--nav-user-bg) 85%, white 15%);
}

.turn-scrubber-link.role-assistant {
  background: var(--nav-assistant-bg);
  color: var(--nav-assistant-text);
}

.turn-scrubber-link.role-assistant:hover {
  background: color-mix(in srgb, var(--nav-assistant-bg) 85%, black 15%);
}

.turn-scrubber-link.role-user.active-turn,
.turn-scrubber-link.role-assistant.active-turn {
  outline-color: var(--accent-light);
}
`
    : "";

  return `
body {
  padding-bottom: calc(48px + 2rem);
}

.turn-scrubber {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 48px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-top: 1px solid var(--border-strong);
  z-index: 20;
  display: flex;
  align-items: center;
}

.turn-scrubber-track {
  display: flex;
  gap: 0.25rem;
  padding: 0 1rem;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
  width: 100%;
  height: 100%;
  align-items: center;
  justify-content: safe center;
  scroll-behavior: smooth;
}

.turn-scrubber-track::-webkit-scrollbar {
  display: none;
}

.turn-scrubber-link {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 28px;
  padding: 0 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--text);
  text-decoration: none;
  border-radius: 4px;
  transition: transform 0.15s ease, outline-color 0.15s ease, background-color 0.15s ease;
  font-variant-numeric: tabular-nums;
  outline: 2px solid transparent;
  outline-offset: 2px;
  background: var(--bg);
}

.turn-scrubber-link:hover {
  background: var(--border);
}

.turn-scrubber-link:focus-visible {
  outline-color: var(--accent-light);
}

.turn-scrubber-link.active-turn {
  transform: scale(1.08);
  outline-color: var(--accent-light);
}
${roleStyles}${progressStyles}`;
}

function scripts(navigation?: NavigationConfig): string {
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

  const download = document.getElementById('download-toggle');
  download.addEventListener('click', function() {
    const html = '<!DOCTYPE html>\\n' + document.documentElement.outerHTML;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = (document.title || 'page').replace(/[^\\w\\-]+/g, '_').replace(/^_+|_+$/g, '') || 'page';
    link.download = filename + '.html';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });

${navigation ? scrubberScripts(navigation) : ''}})();
`;
}

function scrubberScripts(navigation: NavigationConfig): string {
  const progressBar = navigation.progressBar ?? true;
  const progressInit = progressBar
    ? "const progress = document.getElementById('turn-scrubber-progress');"
    : "";
  const progressUpdate = progressBar
    ? "if (progress) { progress.style.width = ((activeIndex + 1) / total * 100) + '%'; }"
    : "";

  return `
  const scrubber = document.querySelector('.turn-scrubber');
  if (scrubber) {
    const turnArticles = document.querySelectorAll('.turn');
    const scrubberLinks = document.querySelectorAll('.turn-scrubber-link');
    ${progressInit}
    const total = turnArticles.length;

    if (total > 0 && scrubberLinks.length === total) {
      const intersecting = new Array(total).fill(false);
      const header = document.querySelector('.site-header');
      const barHeight = scrubber.offsetHeight;
      const headerHeight = header ? header.offsetHeight : 0;
      const activeZoneHeight = Math.min(200, window.innerHeight * 0.25);
      const bottomMargin = Math.max(
        0,
        window.innerHeight - headerHeight - barHeight - activeZoneHeight,
      );
      const rootMargin = '-' + (headerHeight + 8) + 'px 0px -' + bottomMargin + 'px 0px';

      function updateActive() {
        const activeIndex = intersecting.findIndex(Boolean);
        if (activeIndex === -1) return;

        scrubberLinks.forEach((link, i) => {
          const isActive = i === activeIndex;
          link.classList.toggle('active-turn', isActive);
          if (isActive) {
            link.setAttribute('aria-current', 'true');
            link.scrollIntoView({
              behavior: 'smooth',
              block: 'nearest',
              inline: 'center',
            });
          } else {
            link.removeAttribute('aria-current');
          }
        });

        ${progressUpdate}
      }

      const observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const turnIndex = Number(entry.target.getAttribute('id')?.replace('turn-', ''));
            if (!Number.isNaN(turnIndex) && turnIndex >= 0 && turnIndex < total) {
              intersecting[turnIndex] = entry.isIntersecting;
            }
          });
          updateActive();
        },
        { rootMargin, threshold: 0 },
      );

      turnArticles.forEach((turn) => observer.observe(turn));
      intersecting[0] = true;
      updateActive();
    }
  }
`;
}

function resolveOutputPath(inputPath: string): string {
  const ext = path.extname(inputPath);
  const outputName = path.basename(inputPath, ext) + ".html";
  return path.join(path.dirname(inputPath), outputName);
}

function parseInputFile(resolved: string): unknown {
  const text = fs.readFileSync(resolved, "utf-8");
  const trimmedText = text.trim();
  if (!trimmedText) {
    throw new Error(`Input file is empty: ${resolved}`);
  }

  // Some exporters (e.g. opencode) write pretty-printed JSON to a .jsonl
  // extension. Try a single JSON parse first.
  try {
    return JSON.parse(text);
  } catch (err) {
    const firstNonEmpty = trimmedText.split("\n", 1)[0]!.trim();

    // If the first non-empty line is a bare "{" or "[", this is almost certainly
    // a pretty-printed single JSON object/array rather than JSONL. A JSONL file
    // would have a complete JSON value on its first line. Falling back to line-by-line
    // parsing would turn the first line into a confusing "Expected property name or '}'"
    // error and hide the real parse failure.
    let firstLineIsSingleJson = false;
    if (firstNonEmpty === "{" || firstNonEmpty === "[") {
      try {
        JSON.parse(firstNonEmpty);
      } catch {
        firstLineIsSingleJson = true;
      }
    }

    if (firstLineIsSingleJson) {
      throw new Error(
        `Failed to parse ${resolved} as a single JSON document: ${(err as Error).message}`,
      );
    }

    // Otherwise, treat the file as JSONL (one JSON value per line).
    const messages: unknown[] = [];
    let lineNumber = 0;
    for (const line of text.split("\n")) {
      lineNumber++;
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        messages.push(JSON.parse(trimmed));
      } catch (lineErr) {
        throw new Error(
          `Failed to parse JSONL line ${lineNumber} in ${resolved}: ${(lineErr as Error).message}`,
        );
      }
    }
    return messages;
  }
}

export async function renderFile(
  inputPath: string,
  options: RenderOptions = {},
): Promise<string> {
  const { sanitize = true, summarize, username } = options;
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    const display = sanitize ? sanitizePathForDisplay(resolved) : resolved;
    throw new Error(`File not found: ${display}`);
  }

  const parsed = parseInputFile(resolved);
  let { meta, turns } = extractSession(parsed);

  if (sanitize) {
    sanitizeSession(meta, turns);
  }

  if (summarize) {
    const blockCount = turns.reduce((acc, turn) => {
      if (turn.role !== "assistant") return acc;
      return (
        acc +
        (turn.thinking.length > 0 ? 1 : 0) +
        (turn.tools.length > 0 ? 1 : 0)
      );
    }, 0);
    if (blockCount > 0) {
      console.log(`Summarizing ${blockCount} block(s) with llm...`);
      await summarizeTurns(turns, summarize);
      if (sanitize) {
        for (const turn of turns) {
          if (turn.thinkingSummary) {
            turn.thinkingSummary = sanitizeText(turn.thinkingSummary);
          }
          if (turn.toolsSummary) {
            turn.toolsSummary = sanitizeText(turn.toolsSummary);
          }
        }
      }
    }

    if (summarize.sessionSummary) {
      console.log("Summarizing entire session with llm...");
      meta.sessionSummary = await summarizeSession(turns, summarize);
      if (sanitize && meta.sessionSummary) {
        meta.sessionSummary = sanitizeText(meta.sessionSummary);
      }
    }
  }

  if (options.totalCost !== undefined && meta.stats) {
    meta.stats.totalCost = options.totalCost;
  }

  const html = buildPage(
    meta,
    turns,
    username,
    options.navigation,
    options.parentOutputPath,
    options.parentTitle,
  );
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

export async function renderFiles(
  inputPaths: string[],
  options: RenderOptions = {},
): Promise<void> {
  for (const inputPath of inputPaths) {
    await renderFile(inputPath, options);
  }
}
