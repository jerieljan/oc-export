// Helpers shared by the Opencode V1 and V2 JSON extractors. The two export
// formats differ in message shape, so the helpers operate on minimal
// normalized shapes that each extractor maps its messages into.

import type { SessionStats, SubagentLink, ToolCall } from "../types.js";

export interface OpencodeUsage {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

/** Minimal message shape used for statistics. */
export interface OpencodeStatMessage {
  role: "user" | "assistant";
  cost?: number;
  tokens?: OpencodeUsage;
  parts: { type: string }[];
}

/**
 * Extract the subagent session id and state from a task tool's output, which
 * embeds a marker like <task id="..." state="...">.
 */
export function parseTaskState(output: string): {
  stateValue?: string;
  sessionId?: string;
} {
  const match = output.match(/<task\s+id="([^"]+)"\s+state="([^"]+)"/);
  if (!match) return {};
  return { sessionId: match[1], stateValue: match[2] };
}

/** Build the "agent · provider/model · 1.2s" assistant header line. */
export function buildAssistantHeader(labels: {
  agent?: string;
  modelID?: string;
  providerID?: string;
  createdMs?: number;
  completedMs?: number;
}): string | undefined {
  const bits: string[] = [];
  if (labels.agent) bits.push(labels.agent);
  if (labels.modelID) {
    bits.push(labels.providerID ? `${labels.providerID}/${labels.modelID}` : labels.modelID);
  }
  if (labels.createdMs && labels.completedMs) {
    const durationMs = labels.completedMs - labels.createdMs;
    if (durationMs >= 0) {
      bits.push(`${(durationMs / 1000).toFixed(1)}s`);
    }
  }
  return bits.length > 0 ? bits.join(" · ") : undefined;
}

/** Compute session statistics from session-level info and normalized messages. */
export function computeOpencodeStats(
  info: { cost?: number; tokens?: OpencodeUsage; time?: { created?: number; updated?: number } },
  messages: OpencodeStatMessage[],
): SessionStats {
  const createdMs = info.time?.created;
  const updatedMs = info.time?.updated;
  const durationMs =
    createdMs !== undefined && updatedMs !== undefined ? updatedMs - createdMs : undefined;

  let cost: number | undefined = info.cost !== undefined ? info.cost : undefined;
  if (cost === undefined) {
    const sum = messages.reduce((acc, message) => {
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
    const totals = messages.reduce(
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

  const totalMessages = messages.length;
  const userMessages = messages.filter((message) => message.role === "user").length;
  const assistantMessages = totalMessages - userMessages;

  let reasoningParts = 0;
  let toolParts = 0;
  for (const message of messages) {
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

/** Record a subagent link once per session id. */
export function collectSubagentLink(
  subagentsById: Map<string, SubagentLink>,
  tool: ToolCall,
): void {
  if (!tool.subagent) return;
  if (!subagentsById.has(tool.subagent.sessionId)) {
    subagentsById.set(tool.subagent.sessionId, {
      sessionId: tool.subagent.sessionId,
      title: tool.subagent.title,
      description: tool.subagent.description,
    });
  }
}
