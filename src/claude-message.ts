// Raw Claude Code JSONL message format, shared by the Claude source (which
// reads and normalizes session files) and the Claude extractor (which parses
// the normalized export into the canonical session model).

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: {
    web_search_requests?: number;
    web_fetch_requests?: number;
  };
}

export interface ClaudeMessage {
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
    usage?: ClaudeUsage;
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
  [key: string]: unknown;
}
