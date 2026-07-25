#!/usr/bin/env node
import path from "node:path";
import { which } from "./src/util.js";
import { loadConfig, DEFAULT_CONFIG_PATH, type ResolvedConfig } from "./src/config.js";
import { renderFile, renderFiles } from "./src/render.js";
import { pickInteractive, pickSessionById } from "./src/pick.js";

function showHelp(): void {
  console.log(`Usage: oc-export [options] [file.json ...]

Render chat sessions to standalone HTML files.

Options:
  --extractor <name>  Session source: opencode (default) or claude
  --session <id>      Export a session by full ID or last 8 characters and render it
  --output <name>     Rename both output files to <name>.jsonl and <name>.html
  --raw               Skip sanitization
  --no-raw            Enable sanitization (default, overrides raw: true in config)
  --summarize         Summarize thinking and tool-call blocks using llm
  --config <path>     Use a custom config file (default: ${DEFAULT_CONFIG_PATH})
  --help, -h          Show this help message

Config file:
  Settings are read from ${DEFAULT_CONFIG_PATH} if it exists.
  CLI flags override config values. Config values override defaults.

Examples:
  oc-export                               # interactive picker (default: opencode)
  oc-export --extractor claude            # interactive picker for Claude Code
  oc-export --extractor claude --session abc123
  oc-export --output report               # picker with custom output names
  oc-export session.jsonl                 # render a JSONL file
  oc-export session.json                # render a JSON file
  oc-export --config ~/.oc-export.jsonc
`);
}

interface ParsedArgs {
  extractor?: string;
  raw?: boolean;
  config?: string;
  session?: string;
  output?: string;
  summarize?: boolean;
  files: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const files: string[] = [];
  let extractor: string | undefined;
  let raw: boolean | undefined;
  let config: string | undefined;
  let session: string | undefined;
  let output: string | undefined;
  let summarize: boolean | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    } else if (arg === "--extractor") {
      const next = argv[++i];
      if (!next) {
        console.error("Error: --extractor requires a value");
        process.exit(1);
      }
      extractor = next;
    } else if (arg === "--raw") {
      raw = true;
    } else if (arg === "--no-raw") {
      raw = false;
    } else if (arg === "--summarize") {
      summarize = true;
    } else if (arg === "--config") {
      const next = argv[++i];
      if (!next) {
        console.error("Error: --config requires a value");
        process.exit(1);
      }
      config = next;
    } else if (arg === "--session") {
      const next = argv[++i];
      if (!next) {
        console.error("Error: --session requires a value");
        process.exit(1);
      }
      session = next;
    } else if (arg === "--output") {
      const next = argv[++i];
      if (!next) {
        console.error("Error: --output requires a value");
        process.exit(1);
      }
      output = next;
    } else if (arg.startsWith("-")) {
      console.error(`Error: Unknown option ${arg}`);
      process.exit(1);
    } else {
      files.push(arg);
    }
  }

  return { extractor, raw, config, session, output, summarize, files };
}

function htmlOutputPath(outputArg: string): string {
  const resolved = path.resolve(outputArg);
  const dir = path.dirname(resolved);
  const base = path.basename(resolved, path.extname(resolved));
  return path.join(dir, `${base}.html`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig(args.config);
  if (args.extractor) {
    config.extractor = args.extractor;
  }
  const sanitize = !(args.raw ?? config.raw);

  const summarizeEnabled = config.summarize?.enabled === true;
  const summarizeAlways = summarizeEnabled && config.summarize?.always === true;
  const summarizeRequested = args.summarize === true;
  const doSummarize = summarizeEnabled && (summarizeRequested || summarizeAlways);

  if (summarizeRequested && !summarizeEnabled) {
    console.error(
      "Error: --summarize requires summarize.enabled to be true in config",
    );
    process.exit(1);
  }

  if (doSummarize) {
    if (!config.summarize?.model) {
      console.error("Error: Summarization requires summarize.model in config");
      process.exit(1);
    }
    if (!which("llm")) {
      console.error(
        "Error: Summarization requires the `llm` CLI to be installed and on PATH. " +
          "Install it (https://llm.datasette.io/) or omit --summarize.",
      );
      process.exit(1);
    }
  }

  const doSessionSummary =
    doSummarize && config.summarize?.sessionSummary?.enabled === true;

  const summarizeOptions = doSummarize
    ? {
        model: config.summarize!.model!,
        prompt: config.summarize!.prompt,
        thinkingPrompt: config.summarize!.thinkingPrompt,
        toolsPrompt: config.summarize!.toolsPrompt,
        sessionSummary: doSessionSummary,
        sessionSummaryPrompt: config.summarize!.sessionSummary?.prompt,
      }
    : undefined;

  if (args.session && args.files.length > 0) {
    console.error("Error: --session cannot be combined with input files");
    process.exit(1);
  }

  if (args.output && args.files.length > 1) {
    console.error(
      "Error: --output can only be used with a single input file, --session, or the interactive picker",
    );
    process.exit(1);
  }

  if (args.session) {
    await pickSessionById(args.session, {
      sanitize,
      outputBase: args.output,
      config,
      summarize: summarizeOptions,
    });
    return;
  }

  if (args.files.length === 0) {
    await pickInteractive({
      sanitize,
      outputBase: args.output,
      config,
      summarize: summarizeOptions,
    });
    return;
  }

  if (args.files.length === 1) {
    const outputPath = args.output ? htmlOutputPath(args.output) : undefined;
    await renderFile(args.files[0]!, {
      sanitize,
      outputPath,
      summarize: summarizeOptions,
      username: config.username,
      navigation: config.navigation,
    });
    return;
  }

  await renderFiles(args.files, {
    sanitize,
    summarize: summarizeOptions,
    username: config.username,
    navigation: config.navigation,
  });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
