import { formatTimestamp } from "../format.js";
import { joinContent } from "../text.js";
import type { SessionMeta, SessionStats, SubagentLink, ToolCall, Turn } from "../types.js";
import {
  buildAssistantHeader,
  collectSubagentLink,
  computeOpencodeStats,
  parseTaskState,
} from "./opencode-shared.js";
import type { Extractor } from "./types.js";

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
  return computeOpencodeStats(
    { cost: info.cost, tokens: info.tokens, time: info.time },
    session.messages.map((message) => ({
      role: message.type,
      cost: message.cost,
      tokens: message.tokens,
      parts: message.content ?? [],
    })),
  );
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

function parseJsonTool(toolName: string, state: JsonToolState): ToolCall {
  const input = state.input ? JSON.stringify(state.input, null, 2) : "";
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
          collectSubagentLink(subagentsById, tool);
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

function parseJsonSession(session: JsonSession): {
  meta: SessionMeta;
  turns: Turn[];
} {
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
        header: buildAssistantHeader({
          agent: message.agent,
          modelID: message.model?.id,
          providerID: message.model?.providerID,
          createdMs: message.time?.created,
          completedMs: message.time?.completed,
        }),
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
