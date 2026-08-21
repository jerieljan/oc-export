import type { ToolCall, Turn } from "./types.js";
import { last8, runWithLimit, spawnWithStdin, which } from "./util.js";

/** Maximum number of llm processes spawned in parallel. */
const MAX_SUMMARY_CONCURRENCY = 4;

export interface SummarizeOptions {
  model: string;
  /** Fallback or override for both thinking and tool summaries. */
  prompt?: string;
  /** Override for thinking summaries. */
  thinkingPrompt?: string;
  /** Override for tool-call summaries. */
  toolsPrompt?: string;
  /** When true, generate a summary of the whole session after per-turn summaries. */
  sessionSummary?: boolean;
  /** Override for the session summary prompt. */
  sessionSummaryPrompt?: string;
  /** When false, render the session summary panel expanded by default. */
  sessionSummaryCollapsed?: boolean;
}

export const DEFAULT_THINKING_SUMMARY_PROMPT = `You are summarizing an AI assistant's internal thinking trace.

Summarize the trace in 1-2 short paragraphs of plain prose. Explain what problem the assistant was working through, what decisions it made, and what conclusion it reached.

Rules:
- Output plain paragraphs only.
- Do NOT use headings, lists, tables, code blocks, bold labels, or any structured formatting.
- Do NOT quote raw tool output, commands, or file contents.
- Keep it shorter than the original trace.

Example:
The assistant analyzed the user's request to refactor the authentication module. It decided to extract the token validation logic into a shared helper and update the unit tests to cover the new edge cases before changing the API surface.`;

export const DEFAULT_TOOLS_SUMMARY_PROMPT = `You are summarizing a sequence of AI assistant tool calls.

Summarize the sequence in one short paragraph and, if helpful, a 3-5 item bullet list that reads like a changelog. Describe what the assistant accomplished and the user-facing outcome.

Rules:
- Focus on outcomes, not on the commands or raw output.
- Do NOT quote tool names, command output, diffs, logs, file paths, or code.
- Do NOT list every individual tool call; group related calls by purpose.
- Keep the paragraph short and the bullet list optional.

Example:
The assistant inspected the repository state and verified the failing tests. It then applied the fix and confirmed all tests passed.

- Confirmed the bug reproduced in the test suite
- Updated the parser to handle nested brackets
- Ran the full test suite and verified no regressions`;

export const DEFAULT_SESSION_SUMMARY_PROMPT = `You are summarizing a full chat session between a user and an AI assistant.

Summarize the session in one short paragraph and, if helpful, a 3-5 item bullet list that reads like a high-level changelog. Describe the user's overall goal, the main steps the assistant took, and the final outcome or state.

Rules:
- Focus on user intent and assistant outcomes, not on individual tool calls, commands, or raw output.
- Do NOT quote tool names, command output, diffs, logs, file paths, or code.
- Do NOT list every turn; group related work into meaningful phases.
- Keep the paragraph short and the bullet list optional.

Example:
The user asked the assistant to refactor the authentication module. The assistant extracted token validation into a shared helper, updated the unit tests, and verified that the full suite passed before changing the API surface.

- Identified the failing tests and confirmed the bug reproduced
- Refactored the parser to handle nested brackets
- Ran the full test suite and confirmed no regressions`;

/** @deprecated Use the type-specific prompts instead. Kept for backward compatibility. */
export const DEFAULT_SUMMARIZE_PROMPT = DEFAULT_THINKING_SUMMARY_PROMPT;

function serializeThinking(thinking: string[]): string {
  return thinking.join("\n\n---\n\n");
}

function serializeTools(tools: ToolCall[]): string {
  return tools
    .map((tool, index) => {
      if (tool.subagent) {
        const title = tool.subagent.title || last8(tool.subagent.sessionId);
        const state = tool.subagent.state ? ` (${tool.subagent.state})` : "";
        return `${index + 1}. Subagent: ${title}${state}`;
      }
      const parts = [`${index + 1}. ${tool.name}`];
      if (tool.input.trim()) {
        parts.push(`Input:\n${tool.input}`);
      }
      if (tool.output.trim()) {
        parts.push(`Output:\n${tool.output}`);
      }
      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

async function callLlm(model: string, systemPrompt: string, content: string): Promise<string> {
  if (!which("llm")) {
    throw new Error(
      "The `llm` CLI is not installed or not on PATH. " +
        "Install it (https://llm.datasette.io/) or omit --summarize.",
    );
  }

  const { stdout, stderr, exitCode } = await spawnWithStdin(
    ["llm", "-m", model, "-s", systemPrompt, "--no-log"],
    Buffer.from(content, "utf-8"),
  );

  if (exitCode !== 0) {
    const detail = stderr.trim() || "no output";
    throw new Error(`llm failed (exit ${exitCode}): ${detail}`);
  }

  const result = stdout.trim();
  if (!result) {
    throw new Error("llm returned an empty summary.");
  }

  return result;
}

export async function summarizeTurns(turns: Turn[], options: SummarizeOptions): Promise<void> {
  const thinkingPrompt =
    options.thinkingPrompt?.trim() ?? options.prompt?.trim() ?? DEFAULT_THINKING_SUMMARY_PROMPT;
  const toolsPrompt =
    options.toolsPrompt?.trim() ?? options.prompt?.trim() ?? DEFAULT_TOOLS_SUMMARY_PROMPT;
  const tasks: (() => Promise<void>)[] = [];

  for (const turn of turns) {
    if (turn.role !== "assistant") continue;

    if (turn.thinking.length > 0) {
      tasks.push(async () => {
        const content = serializeThinking(turn.thinking);
        turn.thinkingSummary = await callLlm(options.model, thinkingPrompt, content);
      });
    }

    if (turn.tools.length > 0) {
      tasks.push(async () => {
        const content = serializeTools(turn.tools);
        turn.toolsSummary = await callLlm(options.model, toolsPrompt, content);
      });
    }
  }

  // Bounded pool: one llm process per block, at most MAX_SUMMARY_CONCURRENCY
  // at a time, so long sessions don't spawn dozens of processes.
  await runWithLimit(tasks, MAX_SUMMARY_CONCURRENCY);
}

function serializeSession(turns: Turn[]): string {
  return turns
    .map((turn, index) => {
      const parts: string[] = [];
      parts.push(`Turn ${index + 1} - ${turn.role === "user" ? "User" : "Assistant"}`);

      if (turn.content.trim()) {
        parts.push(turn.content);
      }

      if (turn.role === "assistant") {
        const thinking =
          turn.thinkingSummary ||
          (turn.thinking.length > 0 ? turn.thinking.join("\n\n") : undefined);
        if (thinking) {
          parts.push(`Thinking summary:\n${thinking}`);
        }

        const tools =
          turn.toolsSummary || (turn.tools.length > 0 ? serializeTools(turn.tools) : undefined);
        if (tools) {
          parts.push(`Tool calls summary:\n${tools}`);
        }
      }

      return parts.join("\n\n");
    })
    .join("\n\n---\n\n");
}

export async function summarizeSession(turns: Turn[], options: SummarizeOptions): Promise<string> {
  const prompt = options.sessionSummaryPrompt?.trim() ?? DEFAULT_SESSION_SUMMARY_PROMPT;
  const content = serializeSession(turns);
  return await callLlm(options.model, prompt, content);
}
