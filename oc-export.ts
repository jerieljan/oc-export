#!/usr/bin/env bun
import path from "node:path";
import { renderFile, renderFiles } from "./src/render.ts";
import { pickInteractive, pickSessionById } from "./src/pick.ts";

function showHelp(): void {
  console.log(`Usage: oc-export [options] [file.json ...]

Render Opencode chat sessions to standalone HTML files.

Options:
  --session <id>   Export a session by full ID or last 8 characters and render it
  --output <name>  Rename both output files to <name>.json and <name>.html
  --raw            Skip sanitization (sanitization is enabled by default)
  --help, -h       Show this help message

Examples:
  oc-export                           # interactive picker
  oc-export --output report             # picker with custom output names
  oc-export session.json              # render a JSON file
  oc-export session.json --output report
  oc-export a.json b.json             # render multiple JSON files
  oc-export --session abc123            # export and render a session
  oc-export --session abc123 --output report
`);
}

interface ParsedArgs {
  raw: boolean;
  session?: string;
  output?: string;
  files: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const files: string[] = [];
  let raw = false;
  let session: string | undefined;
  let output: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    } else if (arg === "--raw") {
      raw = true;
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

  return { raw, session, output, files };
}

function htmlOutputPath(outputArg: string): string {
  const resolved = path.resolve(outputArg);
  const dir = path.dirname(resolved);
  const base = path.basename(resolved, path.extname(resolved));
  return path.join(dir, `${base}.html`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const sanitize = !args.raw;

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
    await pickSessionById(args.session, { sanitize, outputBase: args.output });
    return;
  }

  if (args.files.length === 0) {
    await pickInteractive({ sanitize, outputBase: args.output });
    return;
  }

  if (args.files.length === 1) {
    const outputPath = args.output ? htmlOutputPath(args.output) : undefined;
    await renderFile(args.files[0]!, { sanitize, outputPath });
    return;
  }

  await renderFiles(args.files, { sanitize });
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
