import type { Extractor } from "./types.js";
import type { SessionMeta, SessionStats, SubagentLink, ToolCall, Turn } from "../types.js";
import { formatTimestamp } from "../format.js";

// JSON export format produced by Opencode.
interface JsonSession {
  info: JsonSessionInfo;
  messages: JsonMessage[];
}

interface JsonSessionInfo {
  id: string;
  title: string;
  parentID?: string;
  agent?: string;
  model?: { id?: string; providerID?: string };
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
  synthetic?: boolean;
  tool?: string;
  callID?: string;
  state?: JsonToolState;
}

interface JsonToolState {
  status?: string;
  input?: Record<string, unknown>;
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

function isJsonSession(data: unknown): data is JsonSession {
  return (
    typeof data === "object" &&
    data !== null &&
    "info" in data &&
    typeof (data as { info: unknown }).info === "object" &&
    (data as { info: unknown }).info !== null &&
    "messages" in data &&
    Array.isArray((data as { messages: unknown }).messages)
  );
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
      return acc + (message.info.cost ?? 0);
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
        const tokens = message.info.tokens;
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
    (message) => message.info.role === "user",
  ).length;
  const assistantMessages = totalMessages - userMessages;

  let reasoningParts = 0;
  let toolParts = 0;
  for (const message of session.messages) {
    for (const part of message.parts) {
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
  const assistantBuckets = new Map<string, Turn>();
  const subagentsById = new Map<string, SubagentLink>();

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
            const tool = parseJsonTool(part.tool, part.state);
            turn.tools.push(tool);
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

  if (subagentsById.size > 0) {
    meta.subagents = [...subagentsById.values()];
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

function parseTaskState(state: JsonToolState): { stateValue?: string; sessionId?: string } {
  if (!state.output) return {};
  const match = state.output.match(/<task\s+id="([^"]+)"\s+state="([^"]+)"/);
  if (!match) return {};
  return { sessionId: match[1], stateValue: match[2] };
}

function parseJsonTool(toolName: string, state: JsonToolState): ToolCall {
  const input = state.input
    ? JSON.stringify(state.input, null, 2)
    : "";
  let output = state.output || "";
  if (state.metadata?.truncated) {
    output = output.trimEnd();
  }

  const tool: ToolCall = { name: toolName, input, output };

  if (toolName === "task" && state.metadata?.sessionId) {
    const task = parseTaskState(state);
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
      sessionId: state.metadata.sessionId,
      title,
      description,
      state: task.stateValue || state.status,
    };
  }

  return tool;
}

export const opencodeExtractor: Extractor = {
  name: "opencode",
  label: "Opencode JSON export",
  canExtract: isJsonSession,
  extract: parseJsonSession,
};
