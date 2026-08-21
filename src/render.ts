import fs from "node:fs";
import path from "node:path";
import { type NavigationConfig, resolveNavigationConfig } from "./config.js";
import { extractSession } from "./extractors/index.js";
import {
  formatCost,
  formatDuration,
  formatTimestamp,
  formatTimestampIsoWithTimezone,
} from "./format.js";
import { scripts } from "./render/client-scripts.js";
import {
  escapeHtml,
  generateFavicon,
  renderAssistantTurn,
  renderParentLink,
  renderSessionSummary,
  renderStats,
  renderSubagentRelations,
  renderTurnScrubber,
  renderUserTurn,
} from "./render/components.js";
import { styles } from "./render/styles.js";
import { sanitizePathForDisplay, sanitizeText } from "./sanitize.js";
import { type SummarizeOptions, summarizeSession, summarizeTurns } from "./summarize.js";
import type { SessionMeta, Turn } from "./types.js";

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
  meta.parentSessionId = meta.parentSessionId ? sanitizeText(meta.parentSessionId) : undefined;
  meta.created = meta.created ? sanitizeText(meta.created) : undefined;
  meta.updated = meta.updated ? sanitizeText(meta.updated) : undefined;
  meta.sessionSummary = meta.sessionSummary ? sanitizeText(meta.sessionSummary) : undefined;

  if (meta.subagents) {
    for (const sub of meta.subagents) {
      sub.sessionId = sanitizeText(sub.sessionId);
      sub.title = sub.title ? sanitizeText(sub.title) : undefined;
      sub.description = sub.description ? sanitizeText(sub.description) : undefined;
    }
  }

  for (const turn of turns) {
    turn.content = sanitizeText(turn.content);
    turn.header = turn.header ? sanitizeText(turn.header) : undefined;
    turn.thinking = turn.thinking.map(sanitizeText);
    turn.synthetic = turn.synthetic.map(sanitizeText);
    if (turn.extensions) {
      for (const extension of turn.extensions) {
        extension.customType = sanitizeText(extension.customType);
        extension.data = sanitizeText(extension.data);
      }
    }
    turn.thinkingSummary = turn.thinkingSummary ? sanitizeText(turn.thinkingSummary) : undefined;
    turn.toolsSummary = turn.toolsSummary ? sanitizeText(turn.toolsSummary) : undefined;

    for (const tool of turn.tools) {
      tool.name = sanitizeText(tool.name);
      tool.input = sanitizeText(tool.input);
      tool.output = sanitizeText(tool.output);
      if (tool.subagent) {
        tool.subagent.sessionId = sanitizeText(tool.subagent.sessionId);
        tool.subagent.title = tool.subagent.title ? sanitizeText(tool.subagent.title) : undefined;
        tool.subagent.description = tool.subagent.description
          ? sanitizeText(tool.subagent.description)
          : undefined;
        tool.subagent.state = tool.subagent.state ? sanitizeText(tool.subagent.state) : undefined;
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

function buildPage(
  meta: SessionMeta,
  turns: Turn[],
  username?: string,
  navigation?: NavigationConfig,
  parentOutputPath?: string,
  parentTitle?: string,
  sessionSummaryCollapsed?: boolean,
): string {
  const title = escapeHtml(meta.title);
  const created = meta.created ?? formatTimestamp(meta.stats?.createdMs);
  const createdIso = formatTimestampIsoWithTimezone(meta.stats?.createdMs);
  const createdHtml = created
    ? createdIso
      ? `<span title="${escapeHtml(createdIso)}">${escapeHtml(created)}</span>`
      : escapeHtml(created)
    : "";
  const subtitle = [
    createdHtml,
    formatDuration(meta.stats?.durationMs),
    formatCostWithTotal(meta.stats?.cost, meta.stats?.totalCost),
  ]
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
  const sessionSummaryExpanded = sessionSummaryCollapsed === false;
  const sessionSummaryHtml = meta.sessionSummary
    ? renderSessionSummary(meta.sessionSummary, sessionSummaryExpanded)
    : "";
  const parentLinkHtml = meta.parentSessionId
    ? renderParentLink(meta.parentSessionId, parentTitle, parentOutputPath)
    : "";
  const subagentRelationsHtml =
    meta.subagents && meta.subagents.length > 0 ? renderSubagentRelations(meta.subagents) : "";
  const navConfig = resolveNavigationConfig(navigation);
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

function resolveOutputPath(inputPath: string): string {
  const ext = path.extname(inputPath);
  const outputName = `${path.basename(inputPath, ext)}.html`;
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

export async function renderFile(inputPath: string, options: RenderOptions = {}): Promise<string> {
  const { sanitize = true, summarize, username } = options;
  const resolved = path.resolve(inputPath);
  if (!fs.existsSync(resolved)) {
    const display = sanitize ? sanitizePathForDisplay(resolved) : resolved;
    throw new Error(`File not found: ${display}`);
  }

  const parsed = parseInputFile(resolved);
  const { meta, turns } = extractSession(parsed);

  if (sanitize) {
    sanitizeSession(meta, turns);
  }

  if (summarize) {
    const blockCount = turns.reduce((acc, turn) => {
      if (turn.role !== "assistant") return acc;
      return acc + (turn.thinking.length > 0 ? 1 : 0) + (turn.tools.length > 0 ? 1 : 0);
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
    options.summarize?.sessionSummaryCollapsed,
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
