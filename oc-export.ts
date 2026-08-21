#!/usr/bin/env node
import path from "node:path";
import { parseArgs, showHelp } from "./src/cli-args.js";
import { loadConfig, resolveSummarizeConfig } from "./src/config.js";
import { pickInteractive, pickSessionById } from "./src/pick.js";
import { renderFile, renderFiles } from "./src/render.js";
import type { SummarizeOptions } from "./src/summarize.js";
import { resolveOutputBase, which } from "./src/util.js";

function htmlOutputPath(outputArg: string): string {
  const { dir, base } = resolveOutputBase(outputArg);
  return path.join(dir, `${base}.html`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.help) {
    showHelp();
    return;
  }
  if (parsed.error !== undefined) {
    console.error(`Error: ${parsed.error}`);
    process.exit(1);
  }
  const args = parsed.args;

  const config = loadConfig(args.config);
  if (args.extractor) {
    config.extractor = args.extractor;
  }
  const sanitize = !(args.raw ?? config.raw);

  const summarize = resolveSummarizeConfig(config.summarize);
  const summarizeRequested = args.summarize === true;
  const doSummarize = summarize.enabled && (summarizeRequested || summarize.always);

  if (summarizeRequested && !summarize.enabled) {
    console.error("Error: --summarize requires summarize.enabled to be true in config");
    process.exit(1);
  }

  let summarizeOptions: SummarizeOptions | undefined;
  if (doSummarize) {
    if (!summarize.model) {
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

    summarizeOptions = {
      model: summarize.model,
      prompt: summarize.prompt,
      thinkingPrompt: summarize.thinkingPrompt,
      toolsPrompt: summarize.toolsPrompt,
      sessionSummary: summarize.sessionSummary?.enabled === true,
      sessionSummaryPrompt: summarize.sessionSummary?.prompt,
      sessionSummaryCollapsed: summarize.sessionSummary?.collapsed,
    };
  }

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
