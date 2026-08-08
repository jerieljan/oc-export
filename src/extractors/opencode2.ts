import type { Extractor } from "./types.js";
import type { SessionMeta, SessionStats, SubagentLink, ToolCall, Turn } from "../types.js";
import { formatTimestamp } from "../format.js";

// JSON export format produced by opencode2 (OpenCode V2).
interface JsonSession {
  info: JsonSessionInfo;
  messages: JsonMessage[];
}

interface JsonSessionInfo {
  id: string;
  title?: string;
  parentID?: string;
  agent?: string;
  model?: { id?: string; providerID?: string; variant?: string };
  version?: string;
  cost?: number;
  time?: { created?: number; updated?: number };
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
}

interface JsonMessage {
  id: string;
  type: "user" | "assistant";
  time: { created?: number; completed?: number };
  text?: string;
  files?: unknown[];
  agents?: unknown[];
  agent?: string;
  model?: { id?: string; providerID?: string; variant?: string };
  content?: JsonPart[];
  snapshot?: unknown;
  finish?: string;
  cost?: number;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
}

interface JsonPart {
  type: string;
  text?: string;
  state?: JsonReasoningState | JsonToolState;
  id?: string;
  name?: string;
  executed?: boolean;
  time?: { created?: number; completed?: number };
}

interface JsonReasoningState {
  reasoningField?: string;
}

interface JsonToolState {
  status?: string;
  input?: Record<string, unknown>;
  content?: JsonContentPart[];
  output?: string;
  metadata?: {
    truncated?: boolean;
    outputPath?: string;
    parentSessionId?: string;
    sessionId?: string;
  };
  title?: string;
  time?: { start?: number; end?: number };
}

interface JsonContentPart {
  type: string;
  text?: string;
}

function isJsonSession(data: unknown): data is JsonSession {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const obj = data as { info?: unknown; messages?: unknown };
  if (typeof obj.info !== "object" || obj.info === null) {
    return false;
  }
  if (!Array.isArray(obj.messages)) {
    return false;
  }
  // V2 messages have a top-level `type` field and no `info` wrapper.
  return obj.messages.every((message) => {
    return (
      typeof message === "object" &&
      message !== null &&
      "type" in message &&
      (message as { type?: string }).type !== undefined &&
      !("info" in message)
    );
  });
}

function computeStats(session: JsonSession): SessionStats {
  const info = session.info;
  const createdMs = info.time?.created;
  const updatedMs = info.time?.updated;
  const durationMs =
    createdMs !== undefined && updatedMs !== undefined
      ? updatedMs - createdMs
      : undefined;

  let cost: number | undefined =
    info.cost !== undefined ? info.cost : undefined;
  if (cost === undefined) {
    const sum = session.messages.reduce((acc, message) => {
      return acc + (message.cost ?? 0);
    }, 0);
    cost = sum > 0 ? sum : undefined;
  }

  let tokensInput: number | undefined;
  let tokensOutput: number | undefined;
  let tokensReasoning: number | undefined;
  let tokensCacheRead: number | undefined;

  if (info.tokens) {
    tokensInput = info.tokens.input;
    tokensOutput = info.tokens.output;
    tokensReasoning = info.tokens.reasoning;
    tokensCacheRead = info.tokens.cache?.read;
  } else {
    let hasTokenData = false;
    const totals = session.messages.reduce(
      (acc, message) => {
        const tokens = message.tokens;
        if (tokens) {
          hasTokenData = true;
          acc.input += tokens.input ?? 0;
          acc.output += tokens.output ?? 0;
          acc.reasoning += tokens.reasoning ?? 0;
          acc.cacheRead += tokens.cache?.read ?? 0;
        }
        return acc;
      },
      { input: 0, output: 0, reasoning: 0, cacheRead: 0 },
    );
    if (hasTokenData) {
      tokensInput = totals.input;
      tokensOutput = totals.output;
      tokensReasoning = totals.reasoning;
      tokensCacheRead = totals.cacheRead;
    }
  }

  const totalMessages = session.messages.length;
  const userMessages = session.messages.filter(
    (message) => message.type === "user",
  ).length;
  const assistantMessages = totalMessages - userMessages;

  let reasoningParts = 0;
  let toolParts = 0;
  for (const message of session.messages) {
    if (!message.content) continue;
    for (const part of message.content) {
      if (part.type === "reasoning") reasoningParts++;
      else if (part.type === "tool") toolParts++;
    }
  }

  return {
    createdMs,
    updatedMs,
    durationMs,
    cost,
    tokensInput,
    tokensOutput,
    tokensReasoning,
    tokensCacheRead,
    totalMessages,
    userMessages,
    assistantMessages,
    reasoningParts,
    toolParts,
  };
}

function joinContent(existing: string, addition: string): string {
  existing = existing.trim();
  addition = addition.trim();
  if (!existing) return addition;
  if (!addition) return existing;
  return `${existing}\n\n${addition}`;
}

function collectToolOutput(state: JsonToolState): string {
  if (state.content) {
    return state.content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text!)
      .join("\n\n");
  }
  return state.output || "";
}

function parseTaskState(output: string): { stateValue?: string; sessionId?: string } {
  const match = output.match(/<task\s+id="([^"]+)"\s+state="([^"]+)"/);
  if (!match) return {};
  return { sessionId: match[1], stateValue: match[2] };
}

function parseJsonTool(toolName: string, state: JsonToolState): ToolCall {
  const input = state.input
    ? JSON.stringify(state.input, null, 2)
    : "";
  let output = collectToolOutput(state);
  if (state.metadata?.truncated) {
    output = output.trimEnd();
  }

  const tool: ToolCall = { name: toolName, input, output };

  if (toolName === "task") {
    const sessionId = state.metadata?.sessionId;
    if (sessionId) {
      const task = parseTaskState(output);
      let title: string | undefined = state.title;
      let description: string | undefined;
      if (typeof state.input === "object" && state.input !== null) {
        description = (state.input as { description?: string }).description;
      }
      if (!title && description) {
        title = description;
      }
      if (description === title) {
        description = undefined;
      }
      tool.subagent = {
        sessionId,
        title,
        description,
        state: task.stateValue || state.status,
      };
    }
  }

  return tool;
}

function buildAssistantHeader(message: JsonMessage): string | undefined {
  const bits: string[] = [];
  if (message.agent) bits.push(message.agent);
  if (message.model?.id) {
    const modelLabel = message.model.providerID
      ? `${message.model.providerID}/${message.model.id}`
      : message.model.id;
    bits.push(modelLabel);
  }
  if (message.time?.created && message.time?.completed) {
    const durationMs = message.time.completed - message.time.created;
    if (durationMs >= 0) {
      bits.push(`${(durationMs / 1000).toFixed(1)}s`);
    }
  }
  return bits.length > 0 ? bits.join(" · ") : undefined;
}

function appendMessageToTurn(
  turn: Turn,
  message: JsonMessage,
  subagentsById: Map<string, SubagentLink>,
): void {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const tools: ToolCall[] = [];

  for (const part of message.content ?? []) {
    switch (part.type) {
      case "text":
        if (part.text) {
          textParts.push(part.text);
        }
        break;
      case "reasoning":
        if (part.text) {
          reasoningParts.push(part.text);
        }
        break;
      case "tool":
        if (part.name && part.state) {
          const tool = parseJsonTool(part.name, part.state as JsonToolState);
          tools.push(tool);
          if (tool.subagent) {
            if (!subagentsById.has(tool.subagent.sessionId)) {
              subagentsById.set(tool.subagent.sessionId, {
                sessionId: tool.subagent.sessionId,
                title: tool.subagent.title,
                description: tool.subagent.description,
              });
            }
          }
        }
        break;
      default:
        // Unknown part types are skipped.
        break;
    }
  }

  if (textParts.length > 0) {
    turn.content = joinContent(turn.content, textParts.join("\n\n"));
  }
  if (reasoningParts.length > 0) {
    turn.thinking.push(...reasoningParts);
  }
  if (tools.length > 0) {
    turn.tools.push(...tools);
  }
}

function parseJsonSession(session: JsonSession): { meta: SessionMeta; turns: Turn[] } {
  const info = session.info;
  const meta: SessionMeta = {
    title: info.title || "Chat Session",
    sessionId: info.id,
    parentSessionId: info.parentID,
    created: formatTimestamp(info.time?.created),
    updated: formatTimestamp(info.time?.updated),
    stats: computeStats(session),
  };

  const turns: Turn[] = [];
  const subagentsById = new Map<string, SubagentLink>();
  let currentAssistantTurn: Turn | undefined;

  function flushAssistantTurn(): void {
    if (!currentAssistantTurn) return;
    // In V2, assistants such as the plan agent emit reasoning but no explicit
    // text parts. Treat reasoning as visible content when no text is present.
    if (!currentAssistantTurn.content && currentAssistantTurn.thinking.length > 0) {
      currentAssistantTurn.content = currentAssistantTurn.thinking.join("\n\n");
      currentAssistantTurn.thinking = [];
    }
    turns.push(currentAssistantTurn);
    currentAssistantTurn = undefined;
  }

  for (const message of session.messages) {
    if (message.type === "user") {
      flushAssistantTurn();
      turns.push({
        role: "user",
        thinking: [],
        tools: [],
        content: (message.text || "").trim(),
        synthetic: [],
      });
      continue;
    }

    if (!currentAssistantTurn) {
      currentAssistantTurn = {
        role: "assistant",
        header: buildAssistantHeader(message),
        thinking: [],
        tools: [],
        content: "",
        synthetic: [],
      };
    }

    appendMessageToTurn(currentAssistantTurn, message, subagentsById);
  }

  flushAssistantTurn();

  if (subagentsById.size > 0) {
    meta.subagents = [...subagentsById.values()];
  }

  return { meta, turns };
}

export const opencode2Extractor: Extractor = {
  name: "opencode2",
  label: "Opencode2 JSON export",
  canExtract: isJsonSession,
  extract: parseJsonSession,
};
