import { formatTimestamp, parseTimestamp } from "../format.js";
import { joinContent } from "../text.js";
import type { SessionMeta, SessionStats, ToolCall, Turn } from "../types.js";
import type { Extractor } from "./types.js";

// Content blocks shared by Pi messages.
interface TextContent {
  type: "text";
  text: string;
}

interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

interface ThinkingContent {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
}

interface ToolCallContent {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

type ContentBlock = TextContent | ImageContent | ThinkingContent | ToolCallContent;

interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

interface UserMessage {
  role: "user";
  content: string | ContentBlock[];
  timestamp: number;
}

interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCallContent)[];
  api: string;
  provider: string;
  model: string;
  usage: Usage;
  stopReason: string;
  errorMessage?: string;
  timestamp: number;
}

interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  details?: unknown;
  usage?: Usage;
  isError: boolean;
  timestamp: number;
}

interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode?: number;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  excludeFromContext?: boolean;
  timestamp: number;
}

interface CustomMessage {
  role: "custom";
  customType: string;
  content: string | ContentBlock[];
  display: boolean;
  details?: unknown;
  timestamp: number;
}

interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string;
  timestamp: number;
}

interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

type AgentMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | BashExecutionMessage
  | CustomMessage
  | BranchSummaryMessage
  | CompactionSummaryMessage;

interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}

interface PiSessionHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  parentSession?: string;
}

interface PiMessageEntry extends SessionEntryBase {
  type: "message";
  message: AgentMessage;
}

interface PiModelChangeEntry extends SessionEntryBase {
  type: "model_change";
  provider: string;
  modelId: string;
}

interface PiThinkingLevelChangeEntry extends SessionEntryBase {
  type: "thinking_level_change";
  thinkingLevel: string;
}

interface PiCompactionEntry extends SessionEntryBase {
  type: "compaction";
  summary: string;
  firstKeptEntryId?: string;
  tokensBefore: number;
  usage?: Usage;
  retainedTail?: AgentMessage[];
  details?: unknown;
  fromHook?: boolean;
}

interface PiBranchSummaryEntry extends SessionEntryBase {
  type: "branch_summary";
  summary: string;
  fromId: string;
  usage?: Usage;
  details?: unknown;
  fromHook?: boolean;
}

interface PiCustomEntry extends SessionEntryBase {
  type: "custom";
  customType: string;
  data: unknown;
}

interface PiCustomMessageEntry extends SessionEntryBase {
  type: "custom_message";
  customType: string;
  content: string | ContentBlock[];
  display: boolean;
  details?: unknown;
}

interface PiLabelEntry extends SessionEntryBase {
  type: "label";
  targetId: string;
  label?: string;
}

interface PiSessionInfoEntry extends SessionEntryBase {
  type: "session_info";
  name: string;
}

type PiEntry =
  | PiSessionHeader
  | PiMessageEntry
  | PiModelChangeEntry
  | PiThinkingLevelChangeEntry
  | PiCompactionEntry
  | PiBranchSummaryEntry
  | PiCustomEntry
  | PiCustomMessageEntry
  | PiLabelEntry
  | PiSessionInfoEntry;

type TreeEntry = Exclude<PiEntry, PiSessionHeader>;

function isPiSessionData(data: unknown): data is PiEntry[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  const first = data[0];
  if (typeof first !== "object" || first === null) return false;
  const header = first as Record<string, unknown>;
  if (header.type !== "session") return false;
  if (typeof header.version !== "number") return false;
  if (typeof header.cwd !== "string") return false;
  return data.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as Record<string, unknown>).type === "message",
  );
}

function extractText(content: string | ContentBlock[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}

function extractImageNote(content: ContentBlock[]): string {
  const images = content.filter((block): block is ImageContent => block.type === "image");
  if (images.length === 0) return "";
  return `\n\n[${images.length} image(s) omitted]`;
}

function collectUserContent(message: UserMessage): string {
  const text = extractText(message.content);
  if (typeof message.content !== "string") {
    return text + extractImageNote(message.content);
  }
  return text;
}

function collectToolResultOutput(message: ToolResultMessage): string {
  const text = extractText(message.content);
  return text + extractImageNote(message.content);
}

function buildAssistantHeader(
  message: AssistantMessage,
  provider?: string,
  model?: string,
  thinkingLevel?: string,
): string | undefined {
  const bits: string[] = [];
  const effectiveModel = message.model || model;
  const effectiveProvider = message.provider || provider;
  if (effectiveModel) {
    bits.push(effectiveProvider ? `${effectiveProvider}/${effectiveModel}` : effectiveModel);
  }
  if (thinkingLevel) bits.push(`thinking: ${thinkingLevel}`);
  return bits.length > 0 ? bits.join(" · ") : undefined;
}

function retainedMessageToEntry(message: AgentMessage, timestamp: string): PiMessageEntry {
  return {
    type: "message",
    id: `retained-${Math.random().toString(36).slice(2, 10)}`,
    parentId: null,
    timestamp,
    message,
  };
}

function applyCompactions(path: TreeEntry[]): PiEntry[] {
  let cutIndex = -1;
  let retainedTail: AgentMessage[] | undefined;

  for (let i = 0; i < path.length; i++) {
    const entry = path[i];
    if (entry?.type !== "compaction") continue;

    if (entry.retainedTail && entry.retainedTail.length > 0) {
      cutIndex = i;
      retainedTail = entry.retainedTail;
    } else if (entry.firstKeptEntryId) {
      const firstKeptEntryId = entry.firstKeptEntryId;
      const idx = path.findIndex((e) => e.id === firstKeptEntryId);
      if (idx !== -1 && (cutIndex === -1 || idx < cutIndex)) {
        cutIndex = idx;
      }
    }
  }

  const result = cutIndex !== -1 ? path.slice(cutIndex) : [...path];

  if (retainedTail && retainedTail.length > 0) {
    const compactionIdx = result.findIndex(
      (e): e is PiCompactionEntry =>
        e.type === "compaction" && Array.isArray(e.retainedTail) && e.retainedTail.length > 0,
    );
    if (compactionIdx !== -1) {
      const retainedEntries = retainedTail.map((message) =>
        retainedMessageToEntry(message, result[compactionIdx]!.timestamp),
      );
      result.splice(compactionIdx + 1, 0, ...retainedEntries);
    }
  }

  return result;
}

function buildMainBranch(entries: PiEntry[]): PiEntry[] {
  const tree = entries.filter((e): e is TreeEntry => e.type !== "session");
  if (tree.length === 0) return [];

  const byId = new Map<string, TreeEntry>();
  const children = new Map<string, string[]>();

  for (const entry of tree) {
    byId.set(entry.id, entry);
    if (entry.parentId) {
      const list = children.get(entry.parentId) ?? [];
      list.push(entry.id);
      children.set(entry.parentId, list);
    }
  }

  const leaves = tree.filter((entry) => !children.has(entry.id));
  let leaf: TreeEntry | undefined;
  if (leaves.length === 0) {
    leaf = tree[tree.length - 1];
  } else if (leaves.length === 1) {
    leaf = leaves[0];
  } else {
    leaf = leaves.reduce((a, b) => {
      // An unparseable timestamp never wins, matching the previous
      // Date.parse() NaN comparison semantics.
      const aMs = parseTimestamp(a.timestamp);
      const bMs = parseTimestamp(b.timestamp);
      if (aMs === undefined || bMs === undefined) return b;
      return aMs > bMs ? a : b;
    });
  }

  if (!leaf) return [];

  const path: TreeEntry[] = [];
  const seen = new Set<string>();
  let current: TreeEntry | undefined = leaf;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  path.reverse();
  return applyCompactions(path);
}

function addExtensionToTurn(turn: Turn | undefined, customType: string, data: string): void {
  if (!turn) return;
  if (!turn.extensions) turn.extensions = [];
  turn.extensions.push({ customType, data });
}

function parseJsonlSession(data: PiEntry[]): {
  meta: SessionMeta;
  turns: Turn[];
} {
  const header = data.find((e): e is PiSessionHeader => e.type === "session");
  const branch = buildMainBranch(data);

  const turns: Turn[] = [];
  const pendingToolCalls = new Map<string, ToolCall>();
  let lastTurn: Turn | undefined;

  let currentProvider: string | undefined;
  let currentModel: string | undefined;
  let currentThinkingLevel: string | undefined;
  let sessionName: string | undefined;

  let totalCost = 0;
  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensCacheRead = 0;
  let hasUsage = false;
  let reasoningParts = 0;
  let toolParts = 0;

  function recordUsage(usage: Usage | undefined): void {
    if (!usage) return;
    hasUsage = true;
    tokensInput += usage.input ?? 0;
    tokensOutput += usage.output ?? 0;
    tokensCacheRead += usage.cacheRead ?? 0;
    totalCost += usage.cost?.total ?? 0;
  }

  function pushUserTurn(content: string): Turn {
    const turn: Turn = {
      role: "user",
      thinking: [],
      tools: [],
      content,
      synthetic: [],
    };
    turns.push(turn);
    lastTurn = turn;
    return turn;
  }

  function pushAssistantTurn(
    content: string,
    thinking: string[],
    tools: ToolCall[],
    headerValue?: string,
  ): Turn {
    const turn: Turn = {
      role: "assistant",
      header: headerValue,
      thinking,
      tools,
      content,
      synthetic: [],
    };
    turns.push(turn);
    lastTurn = turn;
    if (thinking.length > 0) reasoningParts++;
    return turn;
  }

  function ensureAssistantForTool(tool: ToolCall): void {
    if (lastTurn && lastTurn.role === "assistant") {
      lastTurn.tools.push(tool);
    } else {
      pushAssistantTurn(
        "",
        [],
        [tool],
        currentModel ? `${currentProvider ?? ""}/${currentModel}`.replace(/^\//, "") : undefined,
      );
    }
    toolParts++;
  }

  for (const entry of branch) {
    switch (entry.type) {
      case "message": {
        const message = entry.message;

        if (message.role === "user") {
          const content = collectUserContent(message);
          pushUserTurn(content);
          break;
        }

        if (message.role === "assistant") {
          let textContent = "";
          const thinking: string[] = [];
          const tools: ToolCall[] = [];

          for (const block of message.content) {
            if (block.type === "text") {
              textContent = joinContent(textContent, block.text);
            } else if (block.type === "thinking") {
              thinking.push(block.thinking);
            } else if (block.type === "toolCall") {
              const tool: ToolCall = {
                name: block.name,
                input: JSON.stringify(block.arguments ?? {}, null, 2),
                output: "",
              };
              tools.push(tool);
              pendingToolCalls.set(block.id, tool);
              toolParts++;
            }
          }

          const turn = pushAssistantTurn(
            textContent,
            thinking,
            tools,
            buildAssistantHeader(message, currentProvider, currentModel, currentThinkingLevel),
          );
          recordUsage(message.usage);
          currentProvider = message.provider;
          currentModel = message.model;
          // Keep the turn reference for possible extension state that follows.
          lastTurn = turn;
          break;
        }

        if (message.role === "toolResult") {
          const output = collectToolResultOutput(message);
          const pending = pendingToolCalls.get(message.toolCallId);
          if (pending) {
            pending.output = message.isError ? `[error]\n\n${output}` : output;
            pendingToolCalls.delete(message.toolCallId);
          } else {
            const tool: ToolCall = {
              name: message.toolName || "toolResult",
              input: "",
              output,
            };
            ensureAssistantForTool(tool);
          }
          recordUsage(message.usage);
          break;
        }

        if (message.role === "bashExecution") {
          const outputParts: string[] = [];
          if (message.cancelled) outputParts.push("[cancelled]");
          if (message.truncated) outputParts.push("[truncated]");
          if (message.exitCode !== undefined && message.exitCode !== 0) {
            outputParts.push(`[exit code ${message.exitCode}]`);
          }
          outputParts.push(message.output);

          const tool: ToolCall = {
            name: "bash",
            input: message.command,
            output: outputParts.join("\n\n"),
          };
          ensureAssistantForTool(tool);
          break;
        }

        if (message.role === "custom") {
          const data =
            typeof message.content === "string" ? message.content : extractText(message.content);
          addExtensionToTurn(lastTurn, message.customType, data);
          break;
        }

        if (message.role === "branchSummary") {
          pushAssistantTurn(
            `**Branch summary:** ${message.summary}`,
            [],
            [],
            currentModel
              ? `${currentProvider ?? ""}/${currentModel}`.replace(/^\//, "")
              : undefined,
          );
          break;
        }

        if (message.role === "compactionSummary") {
          pushAssistantTurn(
            `**Compaction summary:** ${message.summary}\n\nTokens before compaction: ${message.tokensBefore.toLocaleString()}.`,
            [],
            [],
            currentModel
              ? `${currentProvider ?? ""}/${currentModel}`.replace(/^\//, "")
              : undefined,
          );
          break;
        }

        break;
      }

      case "model_change": {
        currentProvider = entry.provider;
        currentModel = entry.modelId;
        break;
      }

      case "thinking_level_change": {
        currentThinkingLevel = entry.thinkingLevel;
        break;
      }

      case "session_info": {
        sessionName = entry.name;
        break;
      }

      case "compaction": {
        pushAssistantTurn(
          `**Compaction summary:** ${entry.summary}\n\nTokens before compaction: ${entry.tokensBefore.toLocaleString()}.`,
          [],
          [],
          currentModel ? `${currentProvider ?? ""}/${currentModel}`.replace(/^\//, "") : undefined,
        );
        recordUsage(entry.usage);
        break;
      }

      case "branch_summary": {
        pushAssistantTurn(
          `**Branch summary:** ${entry.summary}`,
          [],
          [],
          currentModel ? `${currentProvider ?? ""}/${currentModel}`.replace(/^\//, "") : undefined,
        );
        recordUsage(entry.usage);
        break;
      }

      case "custom": {
        addExtensionToTurn(lastTurn, entry.customType, JSON.stringify(entry.data, null, 2));
        break;
      }

      case "custom_message": {
        const data = typeof entry.content === "string" ? entry.content : extractText(entry.content);
        addExtensionToTurn(lastTurn, entry.customType, data);
        break;
      }

      case "label": {
        // Labels are bookmarks; not rendered in this version.
        break;
      }
    }
  }

  const timestamps: number[] = [];
  if (header) {
    const ms = parseTimestamp(header.timestamp);
    if (ms !== undefined) timestamps.push(ms);
  }
  for (const entry of branch) {
    const ms = parseTimestamp(entry.timestamp);
    if (ms !== undefined) timestamps.push(ms);
  }
  const createdMs = timestamps.length > 0 ? Math.min(...timestamps) : undefined;
  const updatedMs = timestamps.length > 0 ? Math.max(...timestamps) : undefined;

  let title = sessionName;
  if (!title) {
    for (const turn of turns) {
      if (turn.role === "user" && turn.content.trim()) {
        const prompt = turn.content.replace(/\s+/g, " ").trim();
        title = prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt;
        break;
      }
    }
  }

  const userMessages = turns.filter((turn) => turn.role === "user").length;
  const assistantMessages = turns.length - userMessages;

  const stats: SessionStats = {
    createdMs,
    updatedMs,
    durationMs:
      createdMs !== undefined && updatedMs !== undefined ? updatedMs - createdMs : undefined,
    cost: hasUsage && totalCost > 0 ? totalCost : undefined,
    tokensInput: hasUsage ? tokensInput : undefined,
    tokensOutput: hasUsage ? tokensOutput : undefined,
    tokensReasoning: undefined,
    tokensCacheRead: hasUsage ? tokensCacheRead : undefined,
    totalMessages: turns.length,
    userMessages,
    assistantMessages,
    reasoningParts,
    toolParts,
  };

  const meta: SessionMeta = {
    title: title || "Pi session",
    sessionId: header?.id,
    parentSessionId: header?.parentSession,
    created: formatTimestamp(createdMs),
    updated: formatTimestamp(updatedMs),
    stats,
  };

  return { meta, turns };
}

export const piExtractor: Extractor = {
  name: "pi",
  label: "Pi JSONL export",
  canExtract: isPiSessionData,
  extract: (data: unknown) => parseJsonlSession(data as PiEntry[]),
};
