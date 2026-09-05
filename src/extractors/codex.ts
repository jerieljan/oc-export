import { formatTimestamp, parseTimestamp } from "../format.js";
import { joinContent } from "../text.js";
import type { SessionMeta, SessionStats, Turn } from "../types.js";
import type { Extractor } from "./types.js";

// OpenAI Codex rollout JSONL. Each line is
// {timestamp, ordinal, type, payload}; the conversation lives in
// `response_item` payloads, which mirror OpenAI Responses API items. The
// source layer injects the session title from session_index.jsonl into the
// session_meta payload as `thread_name`.

interface RolloutRecord {
  timestamp?: string;
  ordinal?: number;
  type?: string;
  payload?: unknown;
}

interface ContentPart {
  type?: string;
  text?: string;
}

interface MessagePayload {
  type: "message";
  role?: string;
  content?: unknown;
  internal_chat_message_metadata_passthrough?: {
    content_item_kinds?: unknown;
  };
}

interface ReasoningPayload {
  type: "reasoning";
  summary?: { type?: string; text?: string }[];
}

interface CallPayload {
  type: string;
  name?: string;
  namespace?: string;
  arguments?: string;
  input?: string;
  call_id?: string;
  id?: string;
  action?: unknown;
}

interface OutputPayload {
  type: "function_call_output" | "custom_tool_call_output";
  call_id?: string;
  output?: unknown;
}

interface TurnContextPayload {
  type: "turn_context";
  turn_id?: string;
  model?: string;
  effort?: string;
}

interface TaskCompletePayload {
  type: "task_complete";
  turn_id?: string;
  duration_ms?: number;
}

interface TokenUsagePayload {
  thread_token_usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  };
}

interface SessionMetaPayload {
  session_id?: string;
  id?: string;
  timestamp?: string;
  cwd?: string;
  parent_thread_id?: string;
  thread_name?: string;
  originator?: string;
}

// User-role messages injected by Codex itself. Messages that start with one
// of these markers are ambient context, not something the user typed.
const INJECTED_USER_PREFIXES = [
  "<environment_context>",
  "<ENVIRONMENT_CONTEXT>",
  "<user_instructions>",
  "<USER_INSTRUCTIONS>",
  "<turn_context>",
  "<app-context>",
  "<app_context>",
  "<recommended_plugins>",
  "<multi_agent_role>",
  "<permissions",
  "<collaboration_mode>",
];

function isPayloadObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readContentKinds(message: MessagePayload): string[] | undefined {
  const kinds = message.internal_chat_message_metadata_passthrough?.content_item_kinds;
  if (!Array.isArray(kinds)) return undefined;
  const strings = kinds.filter((kind): kind is string => typeof kind === "string");
  return strings.length > 0 ? strings : undefined;
}

function isInjectedUserText(text: string, kinds?: string[]): boolean {
  // Callers skip empty messages before calling; an empty text here means an
  // image-only message that must be preserved.
  const trimmed = text.trim();
  if (kinds) {
    // Newer desktop files label real input as user.text and tag everything
    // else (environment_context, instructions, plugin listings, ...).
    if (kinds.includes("user.text")) return false;
    if (kinds.some((kind) => kind !== "unknown")) return true;
  }
  // Older files carry no metadata; injected blocks always start with a tag.
  // Real prompts start with plain text (or a "# Browser comments:" report
  // that embeds actual user feedback).
  return INJECTED_USER_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

/** Extract joined text plus an image count from Responses content parts. */
function extractContentText(content: unknown): { text: string; images: number } {
  if (typeof content === "string") return { text: content, images: 0 };
  if (!Array.isArray(content)) return { text: "", images: 0 };
  const texts: string[] = [];
  let images = 0;
  for (const part of content as ContentPart[]) {
    if (typeof part !== "object" || part === null) continue;
    if (
      (part.type === "input_text" || part.type === "output_text" || part.type === "text") &&
      typeof part.text === "string"
    ) {
      texts.push(part.text);
    } else if (part.type === "input_image" || part.type === "image") {
      images++;
    }
  }
  return { text: texts.join("\n\n"), images };
}

/**
 * Join text with an omission note when content parts include images. Returns
 * trimmed, non-empty output so image-only parts do not produce leading
 * whitespace.
 */
function composeTextWithImages(text: string, images: number): string {
  const parts = [text.trim()];
  if (images > 0) parts.push(`[${images} image(s) omitted]`);
  return parts.filter(Boolean).join("\n\n");
}

function extractOutputText(output: unknown): string {
  if (output === undefined || output === null) return "";
  if (typeof output === "string") return output;
  const { text, images } = extractContentText(output);
  return composeTextWithImages(text, images);
}

/** Pretty-print JSON tool arguments; leave non-JSON input untouched. */
function formatToolInput(input: unknown): string {
  if (input === undefined || input === null) return "";
  if (typeof input !== "string") return JSON.stringify(input, null, 2);
  if (!input.trim()) return "";
  try {
    return JSON.stringify(JSON.parse(input), null, 2);
  } catch {
    return input;
  }
}

function isCodexRollout(data: unknown): boolean {
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.some(
    (record) =>
      typeof record === "object" &&
      record !== null &&
      (record as Record<string, unknown>).type === "session_meta",
  );
}

function findSessionMetaPayload(records: RolloutRecord[]): SessionMetaPayload | undefined {
  for (const record of records) {
    if (record.type === "session_meta" && isPayloadObject(record.payload)) {
      return record.payload as SessionMetaPayload;
    }
  }
  return undefined;
}

function extractCodexSession(data: unknown): { meta: SessionMeta; turns: Turn[] } {
  const records = (Array.isArray(data) ? data : []) as RolloutRecord[];
  const metaPayload = findSessionMetaPayload(records);

  // First pass: tool outputs, turn durations, token usage, timestamps.
  const toolOutputs = new Map<string, string>();
  const turnDurations = new Map<string, number>();
  let threadUsage: TokenUsagePayload["thread_token_usage"];
  let createdMs: number | undefined;
  let updatedMs: number | undefined;

  for (const record of records) {
    if (record.timestamp) {
      const ms = parseTimestamp(record.timestamp);
      if (ms !== undefined) {
        if (createdMs === undefined) createdMs = ms;
        updatedMs = ms;
      }
    }
    if (!isPayloadObject(record.payload)) continue;
    const payload = record.payload;
    const payloadType = payload.type;

    if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
      const output = payload as unknown as OutputPayload;
      if (typeof output.call_id === "string") {
        toolOutputs.set(output.call_id, extractOutputText(output.output));
      }
    } else if (record.type === "event_msg" && payloadType === "task_complete") {
      const completion = payload as unknown as TaskCompletePayload;
      if (typeof completion.turn_id === "string" && typeof completion.duration_ms === "number") {
        turnDurations.set(completion.turn_id, completion.duration_ms);
      }
    } else if (record.type === "token_usage_record") {
      const usage = payload as unknown as TokenUsagePayload;
      if (usage.thread_token_usage) threadUsage = usage.thread_token_usage;
    }
  }

  // Second pass: build turns from response items.
  const turns: Turn[] = [];
  let assistantTurn: Turn | null = null;
  let currentModel: string | undefined;
  let currentEffort: string | undefined;
  let currentTurnId: string | undefined;

  const getAssistantTurn = (): Turn => {
    if (!assistantTurn) {
      assistantTurn = { role: "assistant", thinking: [], tools: [], content: "", synthetic: [] };
    }
    return assistantTurn;
  };

  const flushAssistantTurn = (): void => {
    if (!assistantTurn) return;
    const bits: string[] = [];
    if (currentModel) bits.push(currentModel);
    if (currentEffort) bits.push(currentEffort);
    const duration = currentTurnId !== undefined ? turnDurations.get(currentTurnId) : undefined;
    if (duration !== undefined && duration >= 0) bits.push(`${(duration / 1000).toFixed(1)}s`);
    if (bits.length > 0) assistantTurn.header = bits.join(" · ");
    turns.push(assistantTurn);
    assistantTurn = null;
  };

  for (const record of records) {
    if (record.type !== "response_item") {
      if (record.type === "turn_context" && isPayloadObject(record.payload)) {
        const context = record.payload as unknown as TurnContextPayload;
        // A new turn_context precedes its own user message, so the pending
        // assistant turn still belongs to the previous turn. Flush it before
        // replacing the context so its header keeps the previous model,
        // effort, and duration.
        flushAssistantTurn();
        if (typeof context.model === "string") currentModel = context.model;
        if (typeof context.effort === "string") currentEffort = context.effort;
        if (typeof context.turn_id === "string") currentTurnId = context.turn_id;
      }
      continue;
    }
    if (!isPayloadObject(record.payload)) continue;
    const payload = record.payload;
    const payloadType = payload.type;

    if (payloadType === "message") {
      const message = payload as unknown as MessagePayload;
      const { text, images } = extractContentText(message.content);

      if (message.role === "assistant") {
        if (text.trim()) {
          const turn = getAssistantTurn();
          turn.content = joinContent(turn.content, text);
        }
      } else if (message.role === "user") {
        if (!text.trim() && images === 0) continue;
        // Empty text means an image-only message; the injected check below
        // only applies to real text.
        if (text.trim() && isInjectedUserText(text, readContentKinds(message))) continue;
        flushAssistantTurn();
        turns.push({
          role: "user",
          thinking: [],
          tools: [],
          content: composeTextWithImages(text, images),
          synthetic: [],
        });
      }
      // developer/system messages are instructions; skip them.
    } else if (payloadType === "reasoning") {
      const reasoning = payload as unknown as ReasoningPayload;
      // Raw reasoning is usually encrypted; only summary items are readable.
      const summaryText = (reasoning.summary ?? [])
        .map((item) => (typeof item?.text === "string" ? item.text : ""))
        .filter((text) => text.trim().length > 0)
        .join("\n\n");
      if (summaryText) {
        getAssistantTurn().thinking.push(summaryText);
      }
    } else if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      const call = payload as unknown as CallPayload;
      const name = call.namespace
        ? `${call.namespace}.${call.name ?? "tool"}`
        : (call.name ?? "tool");
      const input =
        payloadType === "custom_tool_call"
          ? formatToolInput(call.input)
          : formatToolInput(call.arguments);
      const callId = call.call_id ?? call.id;
      getAssistantTurn().tools.push({
        name,
        input,
        output: callId !== undefined ? (toolOutputs.get(callId) ?? "") : "",
      });
    } else if (payloadType === "local_shell_call") {
      const call = payload as unknown as CallPayload;
      const callId = call.call_id ?? call.id;
      getAssistantTurn().tools.push({
        name: "shell",
        input: formatToolInput(call.action ?? undefined),
        output: callId !== undefined ? (toolOutputs.get(callId) ?? "") : "",
      });
    } else if (payloadType === "web_search_call") {
      const call = payload as unknown as CallPayload;
      const callId = call.call_id ?? call.id;
      const action =
        isPayloadObject(call.action) && typeof call.action.query === "string"
          ? call.action.query
          : formatToolInput(call.action);
      getAssistantTurn().tools.push({
        name: "web_search",
        input: action,
        output: callId !== undefined ? (toolOutputs.get(callId) ?? "") : "",
      });
    }
    // Unknown payload types are skipped defensively.
  }
  flushAssistantTurn();

  const userCount = turns.filter((turn) => turn.role === "user").length;
  const assistantCount = turns.filter((turn) => turn.role === "assistant").length;
  const reasoningParts = turns.reduce((sum, turn) => sum + turn.thinking.length, 0);
  const toolParts = turns.reduce((sum, turn) => sum + turn.tools.length, 0);

  const stats: SessionStats = {
    createdMs,
    updatedMs,
    durationMs:
      createdMs !== undefined && updatedMs !== undefined ? updatedMs - createdMs : undefined,
    tokensInput: threadUsage?.input_tokens,
    tokensCacheRead: threadUsage?.cached_input_tokens,
    tokensOutput: threadUsage?.output_tokens,
    tokensReasoning: threadUsage?.reasoning_output_tokens,
    totalMessages: userCount + assistantCount,
    userMessages: userCount,
    assistantMessages: assistantCount,
    reasoningParts,
    toolParts,
  };

  // The source layer injects the indexed title as thread_name; fall back to
  // the first real user prompt.
  let title = metaPayload?.thread_name?.trim();
  if (!title) {
    const firstUser = turns.find((turn) => turn.role === "user");
    if (firstUser) {
      const prompt = firstUser.content.replace(/\s+/g, " ").trim();
      title = prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt;
    }
  }

  const meta: SessionMeta = {
    title: title || "Codex session",
    // `id` is the rollout's own thread id; subagent rollouts reuse the
    // parent's id for session_id, so prefer `id` when present.
    sessionId: metaPayload?.id ?? metaPayload?.session_id,
    created: formatTimestamp(createdMs),
    updated: formatTimestamp(updatedMs),
    stats,
  };
  if (metaPayload?.parent_thread_id) {
    meta.parentSessionId = metaPayload.parent_thread_id;
  }

  return { meta, turns };
}

export const codexExtractor: Extractor = {
  name: "codex",
  label: "OpenAI Codex rollout",
  canExtract: isCodexRollout,
  extract: extractCodexSession,
};
