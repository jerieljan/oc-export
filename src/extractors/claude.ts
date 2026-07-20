import type { Extractor } from "./types.ts";
import type { SessionMeta, SessionStats, ToolCall, Turn } from "../types.ts";
import { formatTimestamp } from "../format.ts";

// Claude Code JSONL message format.
// The source layer normalizes the raw JSONL (inlines subagents, resolves
// persisted outputs) before passing it here.
interface ClaudeMessage {
  type?: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  promptId?: string;
  agentId?: string;
  isSidechain?: boolean;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
    id?: string;
    type?: string;
  };
  attachment?: {
    type?: string;
    filename?: string;
    content?: unknown;
    displayPath?: string;
  };
  subtype?: string;
  durationMs?: number;
  messageCount?: number;
  aiTitle?: string;
  usage?: ClaudeUsage;
  [key: string]: unknown;
}

interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: {
    web_search_requests?: number;
    web_fetch_requests?: number;
  };
}

interface ContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  __oc_inlined_subagent?: boolean;
  __oc_subagent_messages?: ClaudeMessage[];
  [key: string]: unknown;
}

interface NormalizedExport {
  source?: string;
  messages?: ClaudeMessage[];
}

function isClaudeMessageArray(data: unknown): data is ClaudeMessage[] {
  if (!Array.isArray(data) || data.length === 0) return false;
  const first = data[0];
  if (typeof first !== "object" || first === null) return false;
  return (
    "type" in first || "sessionId" in first || "uuid" in first || "message" in first
  );
}

function isNormalizedClaudeExport(data: unknown): data is NormalizedExport {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as NormalizedExport).source === "claude-code" &&
    Array.isArray((data as NormalizedExport).messages)
  );
}

function getMessages(data: unknown): ClaudeMessage[] {
  if (isNormalizedClaudeExport(data)) return data.messages ?? [];
  if (isClaudeMessageArray(data)) return data;
  return [];
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return isNaN(ms) ? undefined : ms;
}

const NON_CONVERSATION_TYPES = new Set([
  "system",
  "last-prompt",
  "mode",
  "permission-mode",
  "ai-title",
  "file-history-snapshot",
  "queue-operation",
]);

function collectMainBranch(messages: ClaudeMessage[]): ClaudeMessage[] {
  const byUuid = new Map<string, ClaudeMessage>();

  for (const message of messages) {
    if (message.uuid) {
      byUuid.set(message.uuid, message);
    }
  }

  // Use the latest conversation message by timestamp as the leaf. Claude's
  // last-prompt entry points to the last user prompt, but the final assistant
  // response is a child of that prompt and has a later timestamp.
  let leaf: ClaudeMessage | null = null;
  let latestMs = -Infinity;

  for (const message of messages) {
    if (
      message.uuid &&
      message.type &&
      !NON_CONVERSATION_TYPES.has(message.type)
    ) {
      const ms = parseTimestamp(message.timestamp) ?? 0;
      if (ms > latestMs) {
        latestMs = ms;
        leaf = message;
      }
    }
  }

  // Fallback: use the last-prompt leafUuid if present.
  if (!leaf) {
    for (const message of messages) {
      if (message.type === "last-prompt" && message.leafUuid) {
        leaf = byUuid.get(message.leafUuid as string) ?? null;
        if (leaf) break;
      }
    }
  }

  // Final fallback: use the last non-system message with a uuid.
  if (!leaf) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]!;
      if (
        message.uuid &&
        message.type &&
        !NON_CONVERSATION_TYPES.has(message.type)
      ) {
        leaf = message;
        break;
      }
    }
  }

  if (!leaf) return [];

  const chain: ClaudeMessage[] = [];
  let current: ClaudeMessage | null = leaf;
  const seen = new Set<string>();

  while (current && current.uuid && !seen.has(current.uuid)) {
    seen.add(current.uuid);
    chain.push(current);
    current = current.parentUuid ? byUuid.get(current.parentUuid) ?? null : null;
  }

  chain.reverse();
  return chain;
}

function collectAttachmentContext(messages: ClaudeMessage[]): Map<string, string[]> {
  const context = new Map<string, string[]>();
  let currentUserUuid: string | null = null;

  for (const message of messages) {
    if (message.type === "user") {
      currentUserUuid = message.uuid ?? null;
    }

    if (message.type === "attachment" && currentUserUuid) {
      const parts = context.get(currentUserUuid) ?? [];
      const text = renderAttachment(message);
      if (text) parts.push(text);
      context.set(currentUserUuid, parts);
    }
  }

  return context;
}

function renderAttachment(message: ClaudeMessage): string {
  const attachment = message.attachment;
  if (!attachment) return "";

  const path = attachment.displayPath || attachment.filename || "attachment";
  let body = "";

  if (attachment.type === "file" && attachment.content && typeof attachment.content === "object") {
    const file = (attachment.content as Record<string, unknown>).file;
    if (file && typeof file === "object") {
      body = (file as Record<string, unknown>).content as string || "";
    }
  } else if (attachment.type === "skill_listing") {
    body = typeof attachment.content === "string" ? attachment.content : "";
  } else if (attachment.type === "task_reminder") {
    body = Array.isArray(attachment.content)
      ? JSON.stringify(attachment.content, null, 2)
      : typeof attachment.content === "string"
        ? attachment.content
        : "";
  } else {
    body = typeof attachment.content === "string"
      ? attachment.content
      : JSON.stringify(attachment.content, null, 2);
  }

  if (!body) return "";
  return `<!-- attachment: ${path} -->\n\n${unescapeClaudeString(body)}`;
}

function unescapeClaudeString(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

const CLAUDE_META_TAG_NAMES = [
  "local-command-caveat",
  "command-name",
  "command-message",
  "command-args",
  "local-command-stdout",
  "task-notification",
];

const CLAUDE_META_TAG_PATTERN = new RegExp(
  `<(?:${CLAUDE_META_TAG_NAMES.join("|")})>[\\s\\S]*?</(?:${CLAUDE_META_TAG_NAMES.join("|")})>`,
  "g",
);

function getFullTagRegex(tagName: string): RegExp {
  return new RegExp(`^\\s*<${tagName}>([\\s\\S]*)</${tagName}>\\s*$`);
}

function stripAnsiCodes(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

function isPureMetaTagContent(text: string): boolean {
  return text.replace(CLAUDE_META_TAG_PATTERN, "").trim().length === 0;
}

interface MetaTagClassification {
  type: "command" | "output" | "drop";
  content: string;
}

function extractTagContent(text: string, tagName: string): string | undefined {
  const match = new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`).exec(text);
  if (!match) return undefined;
  return unescapeClaudeString(match[1]!).trim();
}

function classifyMetaTagMessage(text: string): MetaTagClassification | null {
  if (!isPureMetaTagContent(text)) return null;

  if (getFullTagRegex("local-command-caveat").test(text)) {
    return { type: "drop", content: "" };
  }
  if (getFullTagRegex("task-notification").test(text)) {
    return { type: "drop", content: "" };
  }

  const commandStdout = extractTagContent(text, "local-command-stdout");
  if (commandStdout !== undefined) {
    return { type: "output", content: commandStdout };
  }

  const commandName = extractTagContent(text, "command-name");
  if (commandName !== undefined) {
    return { type: "command", content: commandName };
  }

  const commandMessage = extractTagContent(text, "command-message");
  if (commandMessage !== undefined) {
    return {
      type: "command",
      content: commandMessage.startsWith("/") ? commandMessage : `/${commandMessage}`,
    };
  }

  const commandArgs = extractTagContent(text, "command-args");
  if (commandArgs !== undefined) {
    return { type: "command", content: commandArgs };
  }

  return null;
}

function formatCommandOutput(command: string, output: string): string {
  const indentedOutput = output
    .split("\n")
    .map((line) => `> ⎿ ${line}`)
    .join("\n");
  if (!command) return indentedOutput;
  return `> \`${command}\`\n${indentedOutput}`;
}

function formatCommandOnly(command: string): string {
  return `> \`${command}\``;
}

function extractUserText(content: unknown): string {
  if (typeof content === "string") {
    return stripAnsiCodes(unescapeClaudeString(content));
  }
  if (!Array.isArray(content)) return "";

  const texts: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null) continue;
    const block = item as ContentBlock;
    if (block.type === "tool_result") continue;
    if (block.type === "text" && block.text) {
      texts.push(stripAnsiCodes(unescapeClaudeString(block.text)));
    }
  }
  return texts.join("\n\n");
}

function stringifyContent(content: unknown): string {
  if (typeof content === "string") return unescapeClaudeString(content);
  if (content === null || content === undefined) return "";
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "object" && item !== null && "text" in item) {
          return unescapeClaudeString(
            String((item as Record<string, unknown>).text || ""),
          );
        }
        return JSON.stringify(item, null, 2);
      })
      .join("\n\n");
  }
  return JSON.stringify(content, null, 2);
}

function renderSubagentTranscript(messages: ClaudeMessage[]): string {
  const branch = collectMainBranch(messages);
  const lines: string[] = [];

  for (const message of branch) {
    if (message.type === "user") {
      const content = stringifyContent(message.message?.content);
      if (content.trim()) {
        lines.push(`**Subagent user:** ${content.trim().split("\n")[0]}`);
      }
    } else if (message.type === "assistant") {
      const blocks = Array.isArray(message.message?.content)
        ? (message.message.content as ContentBlock[])
        : [];
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          lines.push(block.text);
        } else if (block.type === "tool_use") {
          lines.push(`\`\`\`json\n${JSON.stringify(block.input, null, 2)}\n\`\`\``);
        }
      }
    }
  }

  return lines.join("\n\n");
}

function extractToolCalls(
  assistantBlocks: ContentBlock[],
  nextUserMessage: ClaudeMessage | null,
): ToolCall[] {
  const toolUseBlocks = assistantBlocks.filter(
    (block): block is ContentBlock & { type: "tool_use"; id: string } =>
      block.type === "tool_use" && typeof block.id === "string",
  );

  const userBlocks = nextUserMessage?.message?.content;
  const results: Record<string, ContentBlock> = {};

  if (Array.isArray(userBlocks)) {
    for (const block of userBlocks as ContentBlock[]) {
      if (
        block.type === "tool_result" &&
        typeof block.tool_use_id === "string"
      ) {
        results[block.tool_use_id] = block;
      }
    }
  }

  return toolUseBlocks.map((toolUse) => {
    const result = results[toolUse.id];
    const name = toolUse.name || "Tool";
    const input = JSON.stringify(toolUse.input ?? {}, null, 2);

    let output = "";
    if (result?.__oc_inlined_subagent && result.__oc_subagent_messages) {
      const agentType = (toolUse.input?.subagent_type as string) || "Agent";
      const prompt = (toolUse.input?.prompt as string) || "";
      const transcript = renderSubagentTranscript(result.__oc_subagent_messages);
      output = [
        `**Agent:** ${agentType}`,
        prompt ? `**Prompt:** ${prompt}` : "",
        "**Transcript:**",
        transcript,
      ]
        .filter(Boolean)
        .join("\n\n");
    } else if (result) {
      output = stringifyContent(result.content);
    }

    return { name, input, output };
  });
}

function buildAssistantHeader(
  messages: ClaudeMessage[],
  turnDuration?: number,
): string | undefined {
  const model = messages[0]?.message?.model;
  const bits: string[] = [];
  if (model) bits.push(model);
  if (turnDuration !== undefined && turnDuration >= 0) {
    bits.push(`${(turnDuration / 1000).toFixed(1)}s`);
  }
  return bits.length > 0 ? bits.join(" · ") : undefined;
}

function computeStats(
  userCount: number,
  assistantCount: number,
  reasoningParts: number,
  toolParts: number,
  usage: ClaudeUsage,
  createdMs?: number,
  updatedMs?: number,
): SessionStats {
  return {
    createdMs,
    updatedMs,
    durationMs:
      createdMs !== undefined && updatedMs !== undefined
        ? updatedMs - createdMs
        : undefined,
    tokensInput: usage.input_tokens,
    tokensOutput: usage.output_tokens,
    tokensReasoning: undefined,
    tokensCacheRead: usage.cache_read_input_tokens,
    totalMessages: userCount + assistantCount,
    userMessages: userCount,
    assistantMessages: assistantCount,
    reasoningParts,
    toolParts,
  };
}

function parseJsonlSession(data: unknown): { meta: SessionMeta; turns: Turn[] } {
  const messages = getMessages(data);
  const mainBranch = collectMainBranch(messages);
  const attachmentContext = collectAttachmentContext(messages);

  // Find metadata from bookkeeping entries.
  let title: string | undefined;
  let createdMs: number | undefined;
  let updatedMs: number | undefined;
  let sessionId: string | undefined;
  let projectPath: string | undefined;
  let gitBranch: string | undefined;

  for (const message of messages) {
    if (message.aiTitle && !title) title = message.aiTitle;
    if (message.sessionId && !sessionId) sessionId = message.sessionId;
    if (typeof message.cwd === "string" && !projectPath) projectPath = message.cwd;
    if (typeof message.gitBranch === "string" && !gitBranch) {
      gitBranch = message.gitBranch;
    }
    if (typeof message.created === "string" && createdMs === undefined) {
      createdMs = parseTimestamp(message.created);
    }
    if (typeof message.modified === "string" && updatedMs === undefined) {
      updatedMs = parseTimestamp(message.modified);
    }
  }

  // Fallback title from first user prompt.
  if (!title) {
    for (const message of mainBranch) {
      if (message.type === "user" && typeof message.message?.content === "string") {
        const prompt = unescapeClaudeString(message.message.content)
          .replace(/\s+/g, " ")
          .trim();
        title = prompt.length > 80 ? prompt.slice(0, 77) + "..." : prompt;
        break;
      }
    }
  }

  // Fallback timestamps from first/last main branch messages.
  if (createdMs === undefined && mainBranch.length > 0) {
    createdMs = parseTimestamp(mainBranch[0]?.timestamp);
  }
  if (updatedMs === undefined && mainBranch.length > 0) {
    updatedMs = parseTimestamp(mainBranch[mainBranch.length - 1]?.timestamp);
  }

  // Collect durations and aggregate usage.
  const durations = new Map<string, number>();
  const usage: ClaudeUsage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };

  for (const message of messages) {
    if (message.subtype === "turn_duration" && message.promptId) {
      durations.set(message.promptId, message.durationMs ?? 0);
    }
    if (message.type === "assistant") {
      const u = (message.message as Record<string, unknown> | undefined)?.usage as ClaudeUsage | undefined;
      if (!u) continue;
      if (u.input_tokens) usage.input_tokens! += u.input_tokens;
      if (u.output_tokens) usage.output_tokens! += u.output_tokens;
      if (u.cache_creation_input_tokens) {
        usage.cache_creation_input_tokens! += u.cache_creation_input_tokens;
      }
      if (u.cache_read_input_tokens) {
        usage.cache_read_input_tokens! += u.cache_read_input_tokens;
      }
    }
  }

  // Build turns by pairing user messages with the following assistant
  // response group.
  const turns: Turn[] = [];
  let userCount = 0;
  let assistantCount = 0;
  let reasoningParts = 0;
  let toolParts = 0;

  for (let i = 0; i < mainBranch.length; i++) {
    const message = mainBranch[i]!;

    if (message.type === "user") {
      userCount++;
      const rawContent = message.message?.content;
      const content = extractUserText(rawContent);
      const synthetic = attachmentContext.get(message.uuid || "") ?? [];

      const meta = typeof content === "string"
        ? classifyMetaTagMessage(content)
        : null;
      if (meta?.type === "drop") {
        continue;
      }

      let finalContent = content;
      if (meta?.type === "command") {
        const nextMessage = mainBranch[i + 1];
        if (nextMessage?.type === "user") {
          const nextContent = extractUserText(nextMessage.message?.content);
          const nextMeta = typeof nextContent === "string"
            ? classifyMetaTagMessage(nextContent)
            : null;
          if (nextMeta?.type === "output") {
            i++;
            finalContent = formatCommandOutput(meta.content, nextMeta.content);
          } else {
            finalContent = formatCommandOnly(meta.content);
          }
        } else {
          finalContent = formatCommandOnly(meta.content);
        }
      } else if (meta?.type === "output") {
        finalContent = formatCommandOutput("", meta.content);
      }

      turns.push({
        role: "user",
        thinking: [],
        tools: [],
        content: finalContent,
        synthetic,
      });
      continue;
    }

    if (message.type === "assistant") {
      // Group consecutive assistant messages that share the same message id
      // (or the same parentUuid when id is missing) into one turn.
      const group: ClaudeMessage[] = [message];
      const parentId = message.parentUuid;
      const messageId = message.message?.id;
      for (let j = i + 1; j < mainBranch.length; j++) {
        const next = mainBranch[j]!;
        if (next.type !== "assistant") break;
        const nextMessageId = next.message?.id;
        if (messageId && nextMessageId) {
          if (nextMessageId !== messageId) break;
        } else {
          if (next.parentUuid !== parentId) break;
        }
        group.push(next);
      }
      i += group.length - 1;
      assistantCount++;

      const contentBlocks: ContentBlock[] = [];
      for (const m of group) {
        if (Array.isArray(m.message?.content)) {
          contentBlocks.push(...(m.message.content as ContentBlock[]));
        }
      }

      const thinking: string[] = [];
      let textContent = "";
      const toolUseBlocks: ContentBlock[] = [];

      for (const block of contentBlocks) {
        if (block.type === "thinking") {
          if (block.thinking) {
            thinking.push(block.thinking);
            reasoningParts++;
          }
        } else if (block.type === "text") {
          if (block.text) {
            textContent = textContent
              ? `${textContent}\n\n${block.text}`
              : block.text;
          }
        } else if (block.type === "tool_use") {
          toolUseBlocks.push(block);
          toolParts++;
        }
      }

      const nextUserMessage = mainBranch[i + 1] ?? null;
      const tools = extractToolCalls(toolUseBlocks, nextUserMessage);

      const turnDuration = message.promptId
        ? durations.get(message.promptId)
        : undefined;

      turns.push({
        role: "assistant",
        header: buildAssistantHeader(group, turnDuration),
        thinking,
        tools,
        content: textContent,
        synthetic: [],
      });
    }
  }

  const stats = computeStats(
    userCount,
    assistantCount,
    reasoningParts,
    toolParts,
    usage,
    createdMs,
    updatedMs,
  );

  const meta: SessionMeta = {
    title: title || "Claude Code session",
    sessionId,
    created: formatTimestamp(createdMs),
    updated: formatTimestamp(updatedMs),
    stats,
  };

  return { meta, turns };
}

export const claudeExtractor: Extractor = {
  name: "claude",
  label: "Claude Code JSONL export",
  canExtract: (data) => isClaudeMessageArray(data) || isNormalizedClaudeExport(data),
  extract: parseJsonlSession,
};
