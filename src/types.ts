// Canonical session model shared by all extractors and the renderer.

export interface SubagentLink {
  sessionId: string;
  title?: string;
  description?: string;
}

export interface SessionMeta {
  title: string;
  sessionId?: string;
  parentSessionId?: string;
  created?: string;
  updated?: string;
  stats?: SessionStats;
  sessionSummary?: string;
  subagents?: SubagentLink[];
}

export interface SessionStats {
  createdMs?: number;
  updatedMs?: number;
  durationMs?: number;
  cost?: number;
  totalCost?: number;
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

export interface SubagentRef {
  sessionId: string;
  title?: string;
  description?: string;
  state?: string;
}

export interface ToolCall {
  name: string;
  input: string;
  output: string;
  subagent?: SubagentRef;
}

export interface ExtensionState {
  customType: string;
  data: string;
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
  extensions?: ExtensionState[];
  thinkingSummary?: string;
  toolsSummary?: string;
}
