import { describe, expect, test } from "bun:test";
import { claudeExtractor } from "../src/extractors/claude.js";
import { codexExtractor } from "../src/extractors/codex.js";
import { extractSession, getExtractors } from "../src/extractors/index.js";
import { kagiExtractor } from "../src/extractors/kagi.js";
import { opencodeExtractor } from "../src/extractors/opencode.js";
import { opencode2Extractor } from "../src/extractors/opencode2.js";
import { openWebUIExtractor } from "../src/extractors/openwebui.js";
import { piExtractor } from "../src/extractors/pi.js";
import type { Turn } from "../src/types.js";

// -- Fixtures -----------------------------------------------------------------

const opencodeV1Session = {
  info: {
    id: "ses_v1abcdefgh",
    title: "V1 session",
    time: { created: 1700000000000, updated: 1700000060000 },
    cost: 0.05,
    tokens: { input: 100, output: 50, reasoning: 10, cache: { read: 5, write: 6 } },
  },
  messages: [
    {
      info: { id: "m1", sessionID: "ses_v1abcdefgh", role: "user" },
      parts: [{ type: "text", text: "Hello there" }],
    },
    {
      info: {
        id: "m2",
        sessionID: "ses_v1abcdefgh",
        parentID: "m1",
        role: "assistant",
        mode: "build",
        modelID: "gpt-4o",
        providerID: "openai",
        time: { created: 1700000001000, completed: 1700000003000 },
      },
      parts: [
        { type: "reasoning", text: "Thinking hard" },
        { type: "text", text: "Hi! How can I help?" },
        {
          type: "tool",
          tool: "bash",
          callID: "c1",
          state: { status: "completed", input: { command: "ls" }, output: "file.txt" },
        },
      ],
    },
  ],
};

const opencodeV2Session = {
  info: {
    id: "ses_v2ijklmnop",
    title: "V2 session",
    parentID: "ses_parent",
    time: { created: 1700000000000, updated: 1700000060000 },
  },
  messages: [
    { type: "user", time: {}, text: "Question?" },
    {
      type: "assistant",
      agent: "build",
      model: { id: "claude-3-5", providerID: "anthropic" },
      time: { created: 1700000001000, completed: 1700000002500 },
      content: [
        { type: "reasoning", text: "pondering" },
        { type: "text", text: "Answer!" },
        {
          type: "tool",
          name: "task",
          state: {
            status: "completed",
            input: { description: "Do things" },
            output: '<task id="child-1" state="completed">',
            metadata: { sessionId: "child-1" },
            title: "Task title",
          },
        },
      ],
    },
  ],
};

const claudeSession = [
  {
    type: "user",
    uuid: "u1",
    sessionId: "cls-123",
    cwd: "/repo",
    timestamp: "2024-01-01T00:00:00Z",
    message: { role: "user", content: "Fix the bug" },
  },
  {
    type: "assistant",
    uuid: "a1",
    parentUuid: "u1",
    timestamp: "2024-01-01T00:00:10Z",
    message: {
      id: "msg_1",
      role: "assistant",
      model: "claude-sonnet-4",
      content: [
        { type: "thinking", thinking: "I should look around" },
        { type: "text", text: "On it." },
        { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } },
      ],
      usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 5 },
    },
  },
  {
    type: "user",
    uuid: "u2",
    parentUuid: "a1",
    timestamp: "2024-01-01T00:00:12Z",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "t1", content: "file contents" }],
    },
  },
  {
    type: "assistant",
    uuid: "a2",
    parentUuid: "u2",
    timestamp: "2024-01-01T00:00:20Z",
    message: {
      id: "msg_1",
      role: "assistant",
      model: "claude-sonnet-4",
      content: [{ type: "text", text: "Fixed it." }],
    },
  },
];

const kagiSession = {
  version: 1,
  exported_at: "2024-01-01T01:00:00Z",
  conversation: { title: "Kagi chat", model_name: "model-x", created_at: "2024-01-01T00:58:00Z" },
  messages: [
    { role: "user", content: "What is Rust?", created_at: "2024-01-01T00:58:10Z" },
    {
      role: "assistant",
      content: "<details><summary>Thinking</summary>chain of thought</details>A systems language.",
      created_at: "2024-01-01T00:59:00Z",
      model_name: "model-x",
      tokens_per_second: 80,
      tokens: 42,
      cost_usd: 0.01,
      duration_ms: 1500,
      references: [
        {
          domain: "rust-lang.org",
          index: 1,
          is_search_result: true,
          percentage: 0.9,
          snippet: "s",
          source: "web",
          title: "Rust",
          url: "https://rust-lang.org",
        },
      ],
    },
  ],
};

const openWebUISession = {
  id: "owui-1",
  title: "WebUI chat",
  created_at: 1700000000,
  updated_at: 1700000060,
  chat: {
    id: "owui-1",
    title: "WebUI chat",
    history: {
      currentId: "m2",
      messages: {
        m1: {
          id: "m1",
          parentId: null,
          childrenIds: ["m2"],
          role: "user",
          content: "Hi WebUI",
          timestamp: 1700000000,
        },
        m2: {
          id: "m2",
          parentId: "m1",
          childrenIds: [],
          role: "assistant",
          content: "",
          model: "llama3",
          timestamp: 1700000010,
          output: [
            { type: "reasoning", content: [{ type: "reasoning", text: "hmm" }] },
            {
              type: "function_call",
              name: "get_time",
              call_id: "call_1",
              arguments: '{"tz":"UTC"}',
            },
            {
              type: "function_call_output",
              call_id: "call_1",
              output: [{ type: "input_text", text: "12:00" }],
            },
            { type: "message", content: [{ type: "output_text", text: "It is noon." }] },
          ],
        },
      },
    },
  },
};

const piSession = [
  {
    type: "session",
    version: 1,
    id: "pi-session-1",
    timestamp: "2024-01-01T00:00:00Z",
    cwd: "/tmp",
  },
  {
    type: "message",
    id: "e1",
    parentId: null,
    timestamp: "2024-01-01T00:00:01Z",
    message: { role: "user", content: "List files", timestamp: 1700000001000 },
  },
  {
    type: "message",
    id: "e2",
    parentId: "e1",
    timestamp: "2024-01-01T00:00:02Z",
    message: {
      role: "assistant",
      api: "x",
      provider: "anthropic",
      model: "claude-3",
      stopReason: "end_turn",
      timestamp: 1700000002000,
      usage: {
        input: 1,
        output: 2,
        cacheRead: 3,
        cacheWrite: 4,
        totalTokens: 10,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.02 },
      },
      content: [
        { type: "thinking", thinking: "use ls" },
        { type: "toolCall", id: "tc1", name: "bash", arguments: { command: "ls" } },
        { type: "text", text: "Here they are." },
      ],
    },
  },
  {
    type: "message",
    id: "e3",
    parentId: "e2",
    timestamp: "2024-01-01T00:00:03Z",
    message: {
      role: "toolResult",
      toolCallId: "tc1",
      toolName: "bash",
      content: [{ type: "text", text: "a.txt" }],
      isError: false,
      timestamp: 1700000003000,
    },
  },
];

const codexSession = [
  {
    timestamp: "2026-09-05T02:51:43.426Z",
    ordinal: 0,
    type: "session_meta",
    payload: {
      session_id: "01codex000-0000-0000-0000-000000000000",
      id: "01codex000-0000-0000-0000-000000000000",
      timestamp: "2026-09-05T02:51:43.426Z",
      cwd: "/tmp/project",
      parent_thread_id: "01parent000-0000-0000-0000-000000000000",
      thread_name: "Build the thing",
    },
  },
  {
    timestamp: "2026-09-05T02:51:43.500Z",
    ordinal: 1,
    type: "turn_context",
    payload: { turn_id: "t1", model: "gpt-6-astra", effort: "low" },
  },
  {
    timestamp: "2026-09-05T02:51:44.000Z",
    ordinal: 2,
    type: "response_item",
    payload: {
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "You are Codex..." }],
    },
  },
  {
    timestamp: "2026-09-05T02:51:44.100Z",
    ordinal: 3,
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: "<environment_context>\n  <cwd>/tmp/project</cwd>\n</environment_context>",
        },
      ],
      internal_chat_message_metadata_passthrough: {
        content_item_kinds: ["environments.environment_context"],
      },
    },
  },
  {
    timestamp: "2026-09-05T02:51:44.200Z",
    ordinal: 4,
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Ship it\n" }],
      internal_chat_message_metadata_passthrough: { content_item_kinds: ["user.text"] },
    },
  },
  {
    timestamp: "2026-09-05T02:51:45.000Z",
    ordinal: 5,
    type: "response_item",
    payload: {
      type: "reasoning",
      summary: [{ type: "summary_text", text: "thinking out loud" }],
      encrypted_content: "gAAAA...",
    },
  },
  {
    timestamp: "2026-09-05T02:51:46.000Z",
    ordinal: 6,
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      call_id: "c1",
      name: "exec",
      input: 'text(await tools.exec_command({cmd:"ls"}));',
    },
  },
  {
    timestamp: "2026-09-05T02:51:46.500Z",
    ordinal: 7,
    type: "response_item",
    payload: {
      type: "custom_tool_call_output",
      call_id: "c1",
      output: [{ type: "input_text", text: "ok" }],
    },
  },
  {
    timestamp: "2026-09-05T02:51:47.000Z",
    ordinal: 8,
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Done!" }],
      phase: "final",
    },
  },
  {
    timestamp: "2026-09-05T02:51:48.000Z",
    ordinal: 9,
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "More\n" }],
      internal_chat_message_metadata_passthrough: { content_item_kinds: ["user.text"] },
    },
  },
  {
    timestamp: "2026-09-05T02:51:49.000Z",
    ordinal: 10,
    type: "response_item",
    payload: {
      type: "function_call",
      call_id: "c2",
      name: "js",
      namespace: "mcp__cua_repl",
      arguments: '{"code":"x()"}',
    },
  },
  {
    timestamp: "2026-09-05T02:51:49.500Z",
    ordinal: 11,
    type: "response_item",
    payload: {
      type: "function_call_output",
      call_id: "c2",
      output: [{ type: "input_text", text: "res" }],
    },
  },
  {
    timestamp: "2026-09-05T02:51:50.000Z",
    ordinal: 12,
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Again done." }],
      phase: "final",
    },
  },
  {
    timestamp: "2026-09-05T02:51:50.500Z",
    ordinal: 13,
    type: "event_msg",
    payload: { type: "task_complete", turn_id: "t1", duration_ms: 2000 },
  },
  {
    timestamp: "2026-09-05T02:51:51.000Z",
    ordinal: 14,
    type: "token_usage_record",
    payload: {
      thread_token_usage: {
        input_tokens: 100,
        cached_input_tokens: 50,
        output_tokens: 20,
        reasoning_output_tokens: 5,
      },
    },
  },
];

// -- Matcher independence (regression guard for registration order) ----------

describe("opencode matcher independence", () => {
  test("v1 matcher rejects v2 exports (messages have no info wrapper)", () => {
    expect(opencodeExtractor.canExtract(opencodeV2Session)).toBe(false);
  });

  test("v2 matcher rejects v1 exports (messages carry an info wrapper)", () => {
    expect(opencode2Extractor.canExtract(opencodeV1Session)).toBe(false);
  });

  test("each matcher accepts its own format", () => {
    expect(opencodeExtractor.canExtract(opencodeV1Session)).toBe(true);
    expect(opencode2Extractor.canExtract(opencodeV2Session)).toBe(true);
  });

  test("dispatch picks the right extractor regardless of intent", () => {
    expect(extractSession(opencodeV1Session).meta.sessionId).toBe("ses_v1abcdefgh");
    expect(extractSession(opencodeV2Session).meta.sessionId).toBe("ses_v2ijklmnop");
  });

  test("codex rollouts dispatch to codex despite the loose claude matcher", () => {
    // Both matchers accept rollout records (they carry a `type` key), so the
    // codex extractor must stay registered ahead of claude.
    expect(claudeExtractor.canExtract(codexSession)).toBe(true);
    expect(extractSession(codexSession).meta.title).toBe("Build the thing");
  });
});

// -- Per-extractor parsing ----------------------------------------------------

describe("opencode v1 extractor", () => {
  const { meta, turns } = extractSession(opencodeV1Session);

  test("parses session metadata and stats", () => {
    expect(meta.title).toBe("V1 session");
    expect(meta.sessionId).toBe("ses_v1abcdefgh");
    expect(meta.stats?.cost).toBe(0.05);
    expect(meta.stats?.tokensInput).toBe(100);
    expect(meta.stats?.totalMessages).toBe(2);
    expect(meta.stats?.userMessages).toBe(1);
    expect(meta.stats?.reasoningParts).toBe(1);
    expect(meta.stats?.toolParts).toBe(1);
  });

  test("groups parts into turns with header and tools", () => {
    expect(turns).toHaveLength(2);
    const [user, assistant] = turns as [Turn, Turn];
    expect(user.role).toBe("user");
    expect(user.content).toBe("Hello there");
    expect(assistant.role).toBe("assistant");
    expect(assistant.thinking).toEqual(["Thinking hard"]);
    expect(assistant.content).toBe("Hi! How can I help?");
    expect(assistant.tools?.[0]?.name).toBe("bash");
    expect(assistant.tools?.[0]?.output).toBe("file.txt");
    expect(assistant.header).toBe("build · openai/gpt-4o · 2.0s");
  });
});

describe("opencode v2 extractor", () => {
  const { meta, turns } = extractSession(opencodeV2Session);

  test("parses session metadata and links subagents", () => {
    expect(meta.title).toBe("V2 session");
    expect(meta.parentSessionId).toBe("ses_parent");
    expect(meta.subagents).toEqual([
      { sessionId: "child-1", title: "Task title", description: "Do things" },
    ]);
  });

  test("collects reasoning, text, and tools into one assistant turn", () => {
    expect(turns).toHaveLength(2);
    const assistant = turns[1]!;
    expect(assistant.thinking).toEqual(["pondering"]);
    expect(assistant.content).toBe("Answer!");
    expect(assistant.tools?.[0]?.subagent?.sessionId).toBe("child-1");
    expect(assistant.header).toBe("build · anthropic/claude-3-5 · 1.5s");
  });
});

describe("claude extractor", () => {
  const { meta, turns } = extractSession(claudeSession);

  test("derives metadata from bookkeeping fields and timestamps", () => {
    expect(meta.sessionId).toBe("cls-123");
    expect(meta.title).toBe("Fix the bug");
    expect(meta.stats?.userMessages).toBe(2);
    expect(meta.stats?.assistantMessages).toBe(2);
    expect(meta.stats?.tokensInput).toBe(10);
    expect(meta.stats?.tokensOutput).toBe(20);
    expect(meta.stats?.tokensCacheRead).toBe(5);
  });

  test("pairs tool_use blocks with their results", () => {
    const firstAssistant = turns[1]!;
    expect(firstAssistant.thinking).toEqual(["I should look around"]);
    expect(firstAssistant.content).toBe("On it.");
    expect(firstAssistant.tools).toHaveLength(1);
    expect(firstAssistant.tools?.[0]).toMatchObject({
      name: "read_file",
      output: "file contents",
    });
    expect(firstAssistant.header).toBe("claude-sonnet-4");
  });

  test("renders both assistant responses as separate turns", () => {
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(turns[3]?.content).toBe("Fixed it.");
  });

  test("formats slash-command user messages", () => {
    const commandSession = [
      {
        type: "user",
        uuid: "c1",
        message: {
          role: "user",
          content:
            "<command-name>/compact</command-name>\n<command-message>compact</command-message>",
        },
      },
    ];
    const result = extractSession(commandSession);
    expect(result.turns[0]?.content).toContain("`/compact`");
  });
});

describe("kagi extractor", () => {
  const { meta, turns } = extractSession(kagiSession);

  test("strips thinking blocks into the thinking array", () => {
    expect(turns[1]?.thinking).toEqual(["chain of thought"]);
    expect(turns[1]?.content).toBe("A systems language.");
  });

  test("maps references and builds the header", () => {
    expect(turns[1]?.references?.[0]).toMatchObject({
      url: "https://rust-lang.org",
      isSearchResult: true,
    });
    expect(turns[1]?.header).toBe("model-x · 1.5s · 80 tok/s · 42 tokens");
    expect(meta.title).toBe("Kagi chat");
    expect(meta.stats?.cost).toBeCloseTo(0.01);
    expect(meta.stats?.tokensOutput).toBe(42);
  });
});

describe("openwebui extractor", () => {
  const { meta, turns } = extractSession(openWebUISession);

  test("walks the current branch in order", () => {
    expect(meta.title).toBe("WebUI chat");
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(turns[0]?.content).toBe("Hi WebUI");
  });

  test("pairs function calls with outputs and extracts reasoning", () => {
    const assistant = turns[1]!;
    expect(assistant.thinking).toEqual(["hmm"]);
    expect(assistant.content).toBe("It is noon.");
    expect(assistant.tools?.[0]).toMatchObject({
      name: "get_time",
      output: "12:00",
    });
    expect(assistant.header).toBe("llama3");
  });
});

describe("pi extractor", () => {
  const { meta, turns } = extractSession(piSession);

  test("parses the session header and usage totals", () => {
    expect(meta.sessionId).toBe("pi-session-1");
    expect(meta.stats?.cost).toBeCloseTo(0.02);
    expect(meta.stats?.tokensInput).toBe(1);
    expect(meta.stats?.toolParts).toBe(1);
    expect(meta.stats?.reasoningParts).toBe(1);
  });

  test("attaches tool results to the pending tool call", () => {
    expect(turns).toHaveLength(2);
    const assistant = turns[1]!;
    expect(assistant.thinking).toEqual(["use ls"]);
    expect(assistant.content).toBe("Here they are.");
    expect(assistant.tools?.[0]).toMatchObject({ name: "bash", output: "a.txt" });
  });
});

// -- Codex record builders for minimal rollout fixtures --------------------------

const codexMetaRecord = () => ({
  timestamp: "2026-09-05T02:51:43.426Z",
  ordinal: 0,
  type: "session_meta",
  payload: {
    session_id: "01codex000-0000-0000-0000-000000000000",
    id: "01codex000-0000-0000-0000-000000000000",
    timestamp: "2026-09-05T02:51:43.426Z",
    cwd: "/tmp/project",
  },
});

const codexTurnContextRecord = (turnId: string, model: string, ordinal: number) => ({
  timestamp: "2026-09-05T02:51:43.500Z",
  ordinal,
  type: "turn_context",
  payload: { turn_id: turnId, model, effort: "low" },
});

const codexUserMessageRecord = (text: string, ordinal: number) => ({
  timestamp: "2026-09-05T02:51:44.000Z",
  ordinal,
  type: "response_item",
  payload: {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
    internal_chat_message_metadata_passthrough: { content_item_kinds: ["user.text"] },
  },
});

const codexAssistantMessageRecord = (text: string, ordinal: number) => ({
  timestamp: "2026-09-05T02:51:45.000Z",
  ordinal,
  type: "response_item",
  payload: {
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  },
});

describe("codex extractor", () => {
  const { meta, turns } = extractSession(codexSession);

  test("parses session metadata, stats, and the injected title", () => {
    expect(meta.title).toBe("Build the thing");
    expect(meta.sessionId).toBe("01codex000-0000-0000-0000-000000000000");
    expect(meta.parentSessionId).toBe("01parent000-0000-0000-0000-000000000000");
    expect(meta.stats?.tokensInput).toBe(100);
    expect(meta.stats?.tokensCacheRead).toBe(50);
    expect(meta.stats?.tokensOutput).toBe(20);
    expect(meta.stats?.tokensReasoning).toBe(5);
    expect(meta.stats?.userMessages).toBe(2);
    expect(meta.stats?.assistantMessages).toBe(2);
    expect(meta.stats?.reasoningParts).toBe(1);
    expect(meta.stats?.toolParts).toBe(2);
  });

  test("builds turns from rollout records and skips injected user messages", () => {
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(turns[0]?.content).toBe("Ship it");
    expect(turns[2]?.content).toBe("More");
  });

  test("collects reasoning, tool calls, and output pairing", () => {
    const firstAssistant = turns[1]!;
    expect(firstAssistant.thinking).toEqual(["thinking out loud"]);
    expect(firstAssistant.content).toBe("Done!");
    expect(firstAssistant.tools?.[0]).toMatchObject({ name: "exec", output: "ok" });
    expect(firstAssistant.header).toBe("gpt-6-astra · low · 2.0s");

    const secondAssistant = turns[3]!;
    expect(secondAssistant.tools?.[0]).toMatchObject({
      name: "mcp__cua_repl.js",
      output: "res",
    });
    expect(secondAssistant.content).toBe("Again done.");
  });

  test("preserves image-only user turns between assistant responses", () => {
    const imageOnly = [
      codexMetaRecord(),
      codexTurnContextRecord("t1", "model-a", 1),
      codexUserMessageRecord("hello", 2),
      codexAssistantMessageRecord("one", 3),
      {
        timestamp: "2026-09-05T02:51:46.000Z",
        ordinal: 4,
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }],
        },
      },
      codexAssistantMessageRecord("two", 5),
    ];
    const result = extractSession(imageOnly);
    expect(result.turns.map((t) => t.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(result.turns[1]?.content).toBe("one");
    expect(result.turns[2]?.content).toBe("[1 image(s) omitted]");
    expect(result.turns[3]?.content).toBe("two");
  });

  test("keeps each assistant turn under its own turn context", () => {
    const twoContexts = [
      codexMetaRecord(),
      codexTurnContextRecord("t1", "model-a", 1),
      codexUserMessageRecord("first", 2),
      codexAssistantMessageRecord("answer one", 3),
      codexTurnContextRecord("t2", "model-b", 4),
      codexUserMessageRecord("second", 5),
      codexAssistantMessageRecord("answer two", 6),
      {
        timestamp: "2026-09-05T02:51:48.000Z",
        ordinal: 7,
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "t1", duration_ms: 1000 },
      },
      {
        timestamp: "2026-09-05T02:51:49.000Z",
        ordinal: 8,
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "t2", duration_ms: 2000 },
      },
    ];
    const result = extractSession(twoContexts);
    const first = result.turns[1]!;
    const second = result.turns[3]!;
    expect(first.header).toBe("model-a · low · 1.0s");
    expect(second.header).toBe("model-b · low · 2.0s");
  });
});

// -- Dispatch -------------------------------------------------------------------

describe("extractSession dispatch", () => {
  test("throws a helpful error for unknown formats", () => {
    expect(() => extractSession({ hello: "world" })).toThrow(/No registered extractor/);
  });

  test("registers cover every built-in extractor exactly once", () => {
    const names = getExtractors()
      .map((e) => e.name)
      .sort();
    expect(names).toEqual(["claude", "codex", "kagi", "opencode", "opencode2", "openwebui", "pi"]);
  });

  test("every registered extractor accepts its own fixture", () => {
    // Guards against a future matcher change silently breaking dispatch.
    expect(claudeExtractor.canExtract(claudeSession)).toBe(true);
    expect(codexExtractor.canExtract(codexSession)).toBe(true);
    expect(kagiExtractor.canExtract(kagiSession)).toBe(true);
    expect(openWebUIExtractor.canExtract(openWebUISession)).toBe(true);
    expect(piExtractor.canExtract(piSession)).toBe(true);
  });
});
