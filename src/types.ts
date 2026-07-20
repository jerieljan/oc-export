// Canonical session model shared by all extractors and the renderer.

export interface SessionMeta {
  title: string;
  sessionId?: string;
  created?: string;
  updated?: string;
  stats?: SessionStats;
}

export interface SessionStats {
  createdMs?: number;
  updatedMs?: number;
  durationMs?: number;
  cost?: number;
  tokensInput?: number;
  tokensOutput?: number;
  tokensReasoning?: number;
  tokensCacheRead?: number;
  totalMessages?: number;
  userMessages?: number;
  assistantMessages?: number;
  reasoningParts?: number;
  toolParts?: number;
}

export interface ToolCall {
  name: string;
  input: string;
  output: string;
}

export interface Reference {
  index: number;
  url: string;
  title: string;
  domain?: string;
  snippet?: string;
  isSearchResult?: boolean;
  percentage?: number;
}

export interface Turn {
  role: "user" | "assistant";
  header?: string;
  thinking: string[];
  tools: ToolCall[];
  references?: Reference[];
  content: string;
  synthetic: string[];
  thinkingSummary?: string;
  toolsSummary?: string;
}
