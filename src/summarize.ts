import type { ToolCall, Turn } from "./types.ts";

export interface SummarizeOptions {
  model: string;
  prompt?: string;
}

export const DEFAULT_SUMMARIZE_PROMPT = `You are provided the thinking or tool call history expressed by an AI agent.

Your task is to provide a concise summary of it, to illustrate what happened in that section of work performed by the AI agent.

Thinking sessions depict the AI agent's thoughts and understanding, and are best summarized in 1-2 paragraphs, shorter than the original.

Tool calls represent execution, which may or may not include the user's response followed by a series of actions performed by the AI agent.

For series of tool calls, collapse them into 1 paragraph and optionally a bulleted list of what the agent accomplished that reads like a changelog.`;

function serializeThinking(thinking: string[]): string {
  return thinking.join("\n\n---\n\n");
}

function serializeTools(tools: ToolCall[]): string {
  return tools
    .map((tool, index) => {
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

async function callLlm(
  model: string,
  systemPrompt: string,
  content: string,
): Promise<string> {
  if (!Bun.which("llm")) {
    throw new Error(
      "The `llm` CLI is not installed or not on PATH. " +
        "Install it (https://llm.datasette.io/) or omit --summarize.",
    );
  }

  const proc = Bun.spawn({
    cmd: ["llm", "-m", model, "-s", systemPrompt, "--no-log"],
    stdin: Buffer.from(content, "utf-8"),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

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

export async function summarizeTurns(
  turns: Turn[],
  options: SummarizeOptions,
): Promise<void> {
  const systemPrompt = options.prompt?.trim() || DEFAULT_SUMMARIZE_PROMPT;
  const tasks: Promise<void>[] = [];

  for (const turn of turns) {
    if (turn.role !== "assistant") continue;

    if (turn.thinking.length > 0) {
      tasks.push(
        (async () => {
          const content = serializeThinking(turn.thinking);
          turn.thinkingSummary = await callLlm(
            options.model,
            systemPrompt,
            content,
          );
        })(),
      );
    }

    if (turn.tools.length > 0) {
      tasks.push(
        (async () => {
          const content = serializeTools(turn.tools);
          turn.toolsSummary = await callLlm(
            options.model,
            systemPrompt,
            content,
          );
        })(),
      );
    }
  }

  await Promise.all(tasks);
}
