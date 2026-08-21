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
  // V1 messages wrap their payload in an `info` field, while V2 messages
  // carry a top-level `type` field instead. Requiring `info` on every message
  // keeps this matcher independent of extractor registration order.
  return obj.messages.every((message) => {
    return typeof message === "object" && message !== null && "info" in message;
  });
}

function computeStats(session: JsonSession): SessionStats {
  const info = session.info;
  return computeOpencodeStats(
    { cost: info.cost, tokens: info.tokens, time: info.time },
    session.messages.map((message) => ({
      role: message.info.role,
      cost: message.info.cost,
      tokens: message.info.tokens,
      parts: message.parts,
    })),
  );
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
        header: buildAssistantHeader({
          agent: message.info.mode,
          modelID: message.info.modelID,
          providerID: message.info.providerID,
          createdMs: message.info.time?.created,
          completedMs: message.info.time?.completed,
        }),
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
            collectSubagentLink(subagentsById, tool);
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
  return parts.filter((p) => p.type === "text" && p.text && p.synthetic).map((p) => p.text!);
}

function parseJsonTool(toolName: string, state: JsonToolState): ToolCall {
  const input = state.input ? JSON.stringify(state.input, null, 2) : "";
  let output = state.output || "";
  if (state.metadata?.truncated) {
    output = output.trimEnd();
  }

  const tool: ToolCall = { name: toolName, input, output };

  if (toolName === "task" && state.metadata?.sessionId) {
    const task = parseTaskState(state.output ?? "");
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
