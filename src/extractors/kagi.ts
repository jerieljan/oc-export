import { formatTimestamp, parseTimestamp } from "../format.js";
import type { Reference, SessionMeta, SessionStats, Turn } from "../types.js";
import type { Extractor } from "./types.js";

// JSON export format produced by Kagi Assistant.
interface KagiSession {
  version: number;
  exported_at: string;
  conversation: KagiConversation;
  messages: KagiMessage[];
}

interface KagiConversation {
  title: string;
  model_name?: string;
  is_saved?: boolean;
  is_shared?: boolean;
  created_at?: string;
}

interface KagiMessage {
  role: "user" | "assistant";
  content: string;
  created_at?: string;
  model_name?: string;
  model_version?: string;
  tokens_per_second?: number;
  tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
  references?: KagiReference[];
}

interface KagiReference {
  domain: string;
  index: number;
  is_search_result: boolean;
  percentage: number;
  snippet: string;
  source: string;
  title: string;
  url: string;
}

function isKagiSession(data: unknown): data is KagiSession {
  if (typeof data !== "object" || data === null) return false;
  const maybe = data as Record<string, unknown>;
  if (typeof maybe.version !== "number") return false;
  if (typeof maybe.conversation !== "object" || maybe.conversation === null) {
    return false;
  }
  if (!Array.isArray(maybe.messages)) return false;
  if (maybe.messages.length === 0) return false;
  const first = maybe.messages[0] as Record<string, unknown>;
  return typeof first.role === "string" && typeof first.content === "string";
}

function extractThinking(content: string): {
  content: string;
  thinking: string[];
} {
  const thinking: string[] = [];
  const pattern = /<details><summary>Thinking<\/summary>([\s\S]*?)<\/details>/gi;
  const cleaned = content
    .replace(pattern, (_match, thinkingContent: string) => {
      thinking.push(thinkingContent.trim());
      return "";
    })
    .trim();
  return { content: cleaned, thinking };
}

function parseReferences(refs: KagiReference[] | undefined): Reference[] {
  if (!refs) return [];
  return refs.map((ref) => ({
    index: ref.index,
    url: ref.url,
    title: ref.title,
    domain: ref.domain,
    snippet: ref.snippet,
    isSearchResult: ref.is_search_result,
    percentage: ref.percentage,
  }));
}

function buildAssistantHeader(message: KagiMessage): string | undefined {
  const bits: string[] = [];
  if (message.model_version) bits.push(message.model_version);
  else if (message.model_name) bits.push(message.model_name);
  if (message.duration_ms !== undefined && message.duration_ms >= 0) {
    bits.push(`${(message.duration_ms / 1000).toFixed(1)}s`);
  }
  if (message.tokens_per_second) {
    bits.push(`${message.tokens_per_second} tok/s`);
  }
  if (message.tokens) {
    bits.push(`${message.tokens.toLocaleString()} tokens`);
  }
  return bits.length > 0 ? bits.join(" · ") : undefined;
}

function parseKagiSession(session: KagiSession): {
  meta: SessionMeta;
  turns: Turn[];
} {
  const createdMs =
    parseTimestamp(session.conversation.created_at) ??
    parseTimestamp(session.messages[0]?.created_at);
  const updatedMs =
    parseTimestamp(session.messages[session.messages.length - 1]?.created_at) ??
    parseTimestamp(session.exported_at);
  const durationMs =
    createdMs !== undefined && updatedMs !== undefined ? updatedMs - createdMs : undefined;

  const turns: Turn[] = [];
  let userMessages = 0;
  let assistantMessages = 0;
  let reasoningParts = 0;
  const toolParts = 0;
  let totalCost = 0;
  let totalTokens = 0;

  for (const message of session.messages) {
    if (message.role === "user") {
      userMessages++;
      turns.push({
        role: "user",
        thinking: [],
        tools: [],
        content: message.content,
        synthetic: [],
      });
      continue;
    }

    assistantMessages++;
    const { content, thinking } = extractThinking(message.content);
    if (thinking.length > 0) reasoningParts++;

    const references = parseReferences(message.references);

    totalCost += message.cost_usd ?? 0;
    totalTokens += message.tokens ?? 0;

    turns.push({
      role: "assistant",
      header: buildAssistantHeader(message),
      thinking,
      tools: [],
      references,
      content,
      synthetic: [],
    });
  }

  const stats: SessionStats = {
    createdMs,
    updatedMs,
    durationMs,
    cost: totalCost > 0 ? totalCost : undefined,
    tokensOutput: totalTokens > 0 ? totalTokens : undefined,
    totalMessages: turns.length,
    userMessages,
    assistantMessages,
    reasoningParts,
    toolParts,
  };

  const meta: SessionMeta = {
    title: session.conversation.title || "Chat Session",
    created: formatTimestamp(createdMs),
    updated: formatTimestamp(updatedMs),
    stats,
  };

  return { meta, turns };
}

export const kagiExtractor: Extractor = {
  name: "kagi",
  label: "Kagi Assistant JSON export",
  canExtract: isKagiSession,
  extract: parseKagiSession,
};
