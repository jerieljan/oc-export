import MarkdownIt from "markdown-it";
import type { NavigationConfig } from "../config.js";
import { formatTimestamp, formatTimestampIsoWithTimezone, formatTokens } from "../format.js";
import type {
  ExtensionState,
  Reference,
  SessionMeta,
  SubagentLink,
  ToolCall,
  Turn,
} from "../types.js";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

function last8(id: string): string {
  return id.slice(-8);
}

function sessionHtmlPath(sessionId: string): string {
  return `./session-${last8(sessionId)}.html`;
}

export function escapeHtml(text: string): string {
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

export function generateFavicon(title: string): string {
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

function statPair(label: string, value: string | undefined, title?: string): string {
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

export function renderStats(meta: SessionMeta): string {
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

  const idHtml = sessionId ? `<span class="session-id"> - ${escapeHtml(sessionId)}</span>` : "";

  return `<section class="container session-stats">
  <h2 class="session-stats-heading">Session statistics${idHtml}</h2>
  ${
    stats
      ? `<div class="stats-grid">
    ${rows.join("\n")}
  </div>`
      : ""
  }
</section>`;
}

export function renderSessionSummary(summary: string, expanded: boolean): string {
  const openAttr = expanded ? " open" : "";
  return `<section class="container session-summary">
  <details${openAttr}>
    <summary class="session-summary-heading">Session summary</summary>
    <div class="session-summary-body">
      ${md.render(summary)}
    </div>
  </details>
</section>`;
}

export function renderParentLink(
  parentSessionId: string,
  parentTitle?: string,
  parentOutputPath?: string,
): string {
  const href = escapeHtml(parentOutputPath ?? sessionHtmlPath(parentSessionId));
  const text = parentTitle ? parentTitle : parentSessionId.slice(-8);
  return `
<div class="parent-link">
  <a href="${href}">← Parent session: ${escapeHtml(text)}</a>
</div>`;
}

export function renderSubagentRelations(subagents: SubagentLink[]): string {
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

export function renderTurnScrubber(turns: Turn[], navigation?: NavigationConfig): string {
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
      const classes = nav.roleColor ? `turn-scrubber-link ${roleClass}` : "turn-scrubber-link";
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

function renderExtensions(extensions: ExtensionState[]): string {
  if (extensions.length === 0) return "";
  const items = extensions
    .map((extension) => {
      return `<details class="collapsible extension">
  <summary>Extension state: ${escapeHtml(extension.customType)}</summary>
  <pre class="extension-code"><code>${escapeHtml(extension.data)}</code></pre>
</details>`;
    })
    .join("\n");
  return items;
}

export function renderUserTurn(turn: Turn, index: number, username?: string): string {
  const messageBlock = turn.content.trim()
    ? `<div class="message user-message">\n    ${md.render(turn.content)}\n  </div>`
    : "";

  let syntheticBlock = "";
  if (turn.synthetic.length > 0) {
    const body = turn.synthetic
      .map((text) => `<pre class="synthetic-code"><code>${escapeHtml(text)}</code></pre>`)
      .join("\n");
    syntheticBlock = `
<details class="collapsible synthetic">
  <summary>Injected context (${turn.synthetic.length})</summary>
  ${body}
</details>`;
  }

  const badgeLabel = escapeHtml(username ?? "User");
  const extensionsBlock = turn.extensions?.length ? renderExtensions(turn.extensions) : "";

  return `
<article class="turn user-turn" id="turn-${index}">
  <div class="turn-header">
    <div class="turn-badge user-badge">${badgeLabel}</div>
  </div>
  ${messageBlock}
  ${syntheticBlock}
  ${extensionsBlock}
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
      const domain = ref.domain ? ` <span class="ref-domain">${escapeHtml(ref.domain)}</span>` : "";
      const snippet = ref.snippet ? `<p class="ref-snippet">${escapeHtml(ref.snippet)}</p>` : "";
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

export function renderAssistantTurn(turn: Turn, index: number): string {
  const parts: string[] = [];

  if (turn.thinking.length > 0) {
    const thinkingBody = turn.thinkingSummary
      ? `<div class="thinking-block">${md.render(turn.thinkingSummary)}</div>`
      : turn.thinking.map((t) => `<div class="thinking-block">${md.render(t)}</div>`).join("\n");
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

  const referencesBlock = hasReferences ? renderTurnReferences(turn.references!, index) : "";

  const extensionsBlock = turn.extensions?.length ? renderExtensions(turn.extensions) : "";

  return `
<article class="turn assistant-turn" id="turn-${index}">
  <div class="turn-header">
    <div class="turn-badge assistant-badge">Assistant</div>
    ${turn.header ? `<div class="assistant-info">${escapeHtml(turn.header)}</div>` : ""}
  </div>
  ${parts.join("\n")}
  ${extensionsBlock}
  ${messageBlock}
  ${referencesBlock}
</article>`;
}
