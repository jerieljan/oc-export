import { DEFAULT_CONFIG, DEFAULT_CONFIG_PATH } from "./config.js";
import { getSources } from "./sources/index.js";

export interface ParsedArgs {
  extractor?: string;
  raw?: boolean;
  config?: string;
  session?: string;
  output?: string;
  summarize?: boolean;
  files: string[];
}

export type ParseArgsResult =
  | { help: true }
  | { help: false; error: string }
  | { help: false; error?: undefined; args: ParsedArgs };

function sourceList(): string {
  return getSources()
    .map((source) =>
      source.name === DEFAULT_CONFIG.extractor ? `${source.name} (default)` : source.name,
    )
    .join(", ");
}

export function showHelp(): void {
  console.log(`Usage: oc-export [options] [file.json ...]

Render chat sessions to standalone HTML files.

Options:
  --extractor <name>  Session source: ${sourceList()}
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
  oc-export --extractor pi                # interactive picker for Pi
  oc-export --extractor opencode2         # interactive picker for OpenCode V2
  oc-export --extractor claude --session abc123
  oc-export --extractor pi --session abc123
  oc-export --extractor opencode2 --session abc123
  oc-export --output report               # picker with custom output names
  oc-export session.jsonl                 # render a JSONL file
  oc-export session.json                  # render a JSON file
  oc-export --config ~/.oc-export.jsonc
`);
}

/**
 * Parse CLI arguments without side effects. Accepts both "--flag value" and
 * "--flag=value" forms. Returns a result object instead of exiting so the
 * caller decides how to report errors and so parsing is unit-testable.
 */
export function parseArgs(argv: string[]): ParseArgsResult {
  const args: ParsedArgs = { files: [] };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--help" || arg === "-h") {
      return { help: true };
    }

    // Split --flag=value into flag and inline value.
    let flag = arg;
    let inlineValue: string | undefined;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flag = arg.slice(0, eq);
        inlineValue = arg.slice(eq + 1);
      }
    }

    // Consume the flag's value from either the "=value" part or the next argv.
    const takeValue = (): string | undefined => {
      if (inlineValue !== undefined) {
        const value = inlineValue;
        inlineValue = undefined;
        return value;
      }
      const next = argv[i + 1];
      // A following flag is never treated as a value; use --flag=value for
      // values that start with "-".
      if (next === undefined || next.startsWith("-")) return undefined;
      i++;
      return next;
    };

    switch (flag) {
      case "--extractor":
      case "--config":
      case "--session":
      case "--output": {
        const value = takeValue();
        if (value === undefined) {
          return { help: false, error: `${flag} requires a value` };
        }
        if (flag === "--extractor") args.extractor = value;
        else if (flag === "--config") args.config = value;
        else if (flag === "--session") args.session = value;
        else args.output = value;
        break;
      }

      case "--raw":
      case "--no-raw":
      case "--summarize": {
        if (inlineValue !== undefined) {
          return { help: false, error: `${flag} does not accept a value` };
        }
        if (flag === "--raw") args.raw = true;
        else if (flag === "--no-raw") args.raw = false;
        else args.summarize = true;
        break;
      }

      default:
        if (flag.startsWith("-")) {
          return { help: false, error: `Unknown option ${flag}` };
        }
        args.files.push(arg);
    }
  }

  return { help: false, args };
}
