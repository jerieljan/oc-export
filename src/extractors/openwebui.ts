import type { Extractor } from "./types.ts";
import type { SessionMeta, SessionStats, ToolCall, Turn } from "../types.ts";
import { formatTimestamp } from "../format.ts";

// JSON export format produced by Open WebUI.
// The export file is a JSON array of chat objects; we process the first one.
// Only the selected branch (history.currentId → parentId chain) is rendered.
// Multiple conversation branches are not supported yet.
interface OpenWebUIExport {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  chat: OpenWebUIChat;
}

interface OpenWebUIChat {
  id: string;
  title: string;
  models?: string[];
  history: OpenWebUIHistory;
}

interface OpenWebUIHistory {
  currentId: string;
  messages: Record<string, OpenWebUIMessage>;
}

interface OpenWebUIMessage {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  models?: string[];
  model?: string;
  output?: OpenWebUIOutputItem[];
  usage?: OpenWebUIUsage;
  done?: boolean;
}

interface OpenWebUIUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  input_tokens_details?: {
    cache_write_tokens?: number;
    cached_tokens?: number;
  };
  output_tokens_details?: {
    reasoning_tokens?: number;
  };
}

interface OpenWebUIOutputItem {
  type: string;
  id?: string;
  content?: OpenWebUIContentItem[];
  encrypted_content?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  status?: string;
  output?: OpenWebUIOutputContentItem[];
}

interface OpenWebUIContentItem {
  type: string;
  text?: string;
  // Other fields such as image_url are ignored for rendering.
}

interface OpenWebUIOutputContentItem {
  type: string;
  text?: string;
}

function isOpenWebUISession(data: unknown): data is OpenWebUIExport {
  const candidate = Array.isArray(data) ? data[0] : data;
  if (typeof candidate !== "object" || candidate === null) return false;

  const maybe = candidate as Record<string, unknown>;
  if (typeof maybe.chat !== "object" || maybe.chat === null) return false;

  const chat = maybe.chat as Record<string, unknown>;
  if (typeof chat.history !== "object" || chat.history === null) return false;

  const history = chat.history as Record<string, unknown>;
  if (typeof history.messages !== "object" || history.messages === null) {
    return false;
  }
  if (Array.isArray(history.messages)) return false;
  if (typeof history.currentId !== "string") return false;

  const messages = history.messages as Record<string, unknown>;
  const firstKey = Object.keys(messages)[0];
  if (!firstKey) return false;

  const firstMessage = messages[firstKey] as Record<string, unknown>;
  return (
    typeof firstMessage.role === "string" &&
    (firstMessage.role === "user" || firstMessage.role === "assistant") &&
    "parentId" in firstMessage
  );
}

function normalizeExport(data: unknown): OpenWebUIExport {
  if (Array.isArray(data)) {
    return data[0] as OpenWebUIExport;
  }
  return data as OpenWebUIExport;
}

function buildMessageChain(history: OpenWebUIHistory): OpenWebUIMessage[] {
  const messages = history.messages;
  const chain: OpenWebUIMessage[] = [];
  let current = messages[history.currentId];

  while (current) {
    chain.push(current);
    if (current.parentId === null) break;
    current = messages[current.parentId];
  }

  return chain.reverse();
}

function computeStats(
  exportObj: OpenWebUIExport,
  chain: OpenWebUIMessage[],
): SessionStats {
  const createdMs = exportObj.created_at * 1000;
  const updatedMs = exportObj.updated_at * 1000;
  const durationMs = updatedMs - createdMs;

  let tokensInput = 0;
  let tokensOutput = 0;
  let tokensReasoning = 0;
  let tokensCacheRead = 0;
  let hasTokenData = false;

  let userMessages = 0;
  let assistantMessages = 0;
  let reasoningParts = 0;
  let toolParts = 0;

  for (const message of chain) {
    if (message.role === "user") {
      userMessages++;
      continue;
    }

    assistantMessages++;

    if (message.usage) {
      hasTokenData = true;
      tokensInput += message.usage.input_tokens ?? 0;
      tokensOutput += message.usage.output_tokens ?? 0;
      tokensReasoning +=
        message.usage.output_tokens_details?.reasoning_tokens ?? 0;
      tokensCacheRead +=
        message.usage.input_tokens_details?.cached_tokens ?? 0;
    }

    for (const item of message.output ?? []) {
      if (item.type === "reasoning") {
        reasoningParts++;
      } else if (item.type === "function_call") {
        toolParts++;
      }
    }
  }

  return {
    createdMs,
    updatedMs,
    durationMs,
    tokensInput: hasTokenData ? tokensInput : undefined,
    tokensOutput: hasTokenData ? tokensOutput : undefined,
    tokensReasoning: hasTokenData ? tokensReasoning : undefined,
    tokensCacheRead: hasTokenData ? tokensCacheRead : undefined,
    totalMessages: chain.length,
    userMessages,
    assistantMessages,
    reasoningParts,
    toolParts,
  };
}

function extractReasoning(item: OpenWebUIOutputItem): string {
  if (item.content && item.content.length > 0) {
    const text = item.content
      .filter((c) => c.type === "reasoning" && typeof c.text === "string")
      .map((c) => c.text!)
      .join("\n\n");
    if (text.trim()) return text;
  }

  if (item.encrypted_content) {
    return "Reasoning encrypted";
  }

  return "Reasoning";
}

function formatToolInput(argumentsJson: string | undefined): string {
  if (!argumentsJson) return "";
  try {
    const parsed = JSON.parse(argumentsJson) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return argumentsJson;
  }
}

function formatToolOutput(
  outputItems: OpenWebUIOutputContentItem[] | undefined,
): string {
  if (!outputItems || outputItems.length === 0) return "";

  const text = outputItems
    .filter((item) => item.type === "input_text" && typeof item.text === "string")
    .map((item) => item.text!)
    .join("\n\n");

  if (!text.trim()) return "";

  try {
    const parsed = JSON.parse(text) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function extractMessageText(content: OpenWebUIContentItem[]): string {
  return content
    .filter((item) => item.type === "output_text" && typeof item.text === "string")
    .map((item) => item.text!)
    .join("\n\n");
}

function joinContent(existing: string, addition: string): string {
  existing = existing.trim();
  addition = addition.trim();
  if (!existing) return addition;
  if (!addition) return existing;
  return `${existing}\n\n${addition}`;
}

function buildAssistantHeader(message: OpenWebUIMessage): string | undefined {
  if (message.model) return message.model;
  return undefined;
}

function parseAssistantMessage(message: OpenWebUIMessage): Turn {
  const turn: Turn = {
    role: "assistant",
    header: buildAssistantHeader(message),
    thinking: [],
    tools: [],
    content: message.content || "",
    synthetic: [],
  };

  const toolMap = new Map<string, ToolCall>();

  for (const item of message.output ?? []) {
    switch (item.type) {
      case "reasoning": {
        turn.thinking.push(extractReasoning(item));
        break;
      }
      case "function_call": {
        if (item.name && item.call_id) {
          const tool: ToolCall = {
            name: item.name,
            input: formatToolInput(item.arguments),
            output: "",
          };
          toolMap.set(item.call_id, tool);
          turn.tools.push(tool);
        }
        break;
      }
      case "function_call_output": {
        if (item.call_id) {
          const tool = toolMap.get(item.call_id);
          if (tool) {
            tool.output = joinContent(tool.output, formatToolOutput(item.output));
          }
        }
        break;
      }
      case "message": {
        if (item.content) {
          turn.content = joinContent(turn.content, extractMessageText(item.content));
        }
        break;
      }
      default: {
        // Unknown output item types are ignored for rendering.
        break;
      }
    }
  }

  return turn;
}

function parseUserMessage(message: OpenWebUIMessage): Turn {
  return {
    role: "user",
    thinking: [],
    tools: [],
    content: message.content || "",
    synthetic: [],
  };
}

function parseOpenWebUISession(
  exportObj: OpenWebUIExport,
): { meta: SessionMeta; turns: Turn[] } {
  const history = exportObj.chat.history;
  const chain = buildMessageChain(history);

  const meta: SessionMeta = {
    title: exportObj.title || exportObj.chat.title || "Chat Session",
    sessionId: exportObj.id || exportObj.chat.id,
    created: formatTimestamp(exportObj.created_at * 1000),
    updated: formatTimestamp(exportObj.updated_at * 1000),
    stats: computeStats(exportObj, chain),
  };

  const turns: Turn[] = chain.map((message) => {
    if (message.role === "user") {
      return parseUserMessage(message);
    }
    return parseAssistantMessage(message);
  });

  return { meta, turns };
}

export const openWebUIExtractor: Extractor = {
  name: "openwebui",
  label: "Open WebUI JSON export",
  canExtract: isOpenWebUISession,
  extract: (data: unknown) => parseOpenWebUISession(normalizeExport(data)),
};
