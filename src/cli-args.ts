import { DEFAULT_CONFIG, DEFAULT_CONFIG_PATH } from "./config.js";
import { getSources } from "./sources/index.js";

export interface ParsedArgs {
  command?: "ls";
  directory?: string;
  json?: boolean;
  jsonExtended?: boolean;
  all?: boolean;
  limit?: number;
  extractor?: string;
  raw?: boolean;
  config?: string;
  session?: string;
  output?: string;
  summarize?: boolean;
  files: string[];
}

export type ParseArgsResult =
  | { help: true; command?: "ls" }
  | { help: false; error: string }
  | { help: false; error?: undefined; args: ParsedArgs };

function sourceList(): string {
  return getSources()
    .map((source) =>
      source.name === DEFAULT_CONFIG.extractor ? `${source.name} (default)` : source.name,
    )
    .join(", ");
}

export function showHelp(command?: "ls"): void {
  const shared = `  --extractor <name>  Local session source: ${sourceList()}
  --config <path>     Read settings from a JSON or JSONC file
  --help, -h          Show help for this command`;
  const config = `Settings: ${DEFAULT_CONFIG_PATH}
CLI flags override config values; config values override defaults.
Exit status: 0 on success (including an empty list); 1 on error.
Errors go to stderr. Options accept --flag value or --flag=value.`;

  if (command === "ls") {
    console.log(`Usage: oc-export ls [options] [directory]
       npx oc-export ls [options] [directory]

List recent local sessions without prompting or exporting.
The directory filter matches the exact working directory, not subdirectories.
Results are newest first. --all and --limit override the configured limit.
Filtering happens before the configured limit:
picker.limit (default: 20), overridden by claude.limit, pi.limit, or codex.limit.

Options:
  --json             Print the compatible JSON array; empty result: []
  --json-extended    Print extended JSON with coverage, warnings, and provenance
  --all              Retrieve all sessions, independently of picker limits
  --limit <N>        Retrieve at most N sessions; overrides picker limits
${shared}

Output:
  Default: tab-separated ID, UPDATED (UTC), DIRECTORY, TITLE, with a header.
  Empty result: No sessions found.
  JSON: objects with id, title, directory, time_updated (Unix milliseconds),
        and optional source-specific fields such as cost.
  Extended JSON: schema_version, extractor, scope, coverage, warnings, sessions.
  Extended JSON timestamps are UTC strings or null; results sort by activity.
  Incomplete extended JSON scans emit JSON and exit 1; inspect coverage.scan_complete.
  Listing metadata is not sanitized. Export-only options are not accepted.

${config}

Examples:
  npx oc-export ls --extractor codex .
  npx oc-export ls --extractor codex --json
  npx oc-export ls --config ./config.jsonc /path/to/project

Use a full ID from the list with oc-export --extractor <name> --session <id>.
`);
    return;
  }

  console.log(`Usage: oc-export [options] [file.json|file.jsonl ...]
       oc-export ls [options] [directory]
       npx oc-export [options] [file.json|file.jsonl ...]

Export local chat sessions and render standalone HTML files.

Choose a workflow:
  No files or --session  Open an interactive session picker (requires a terminal)
  --session <id>        Export and render a session without prompting
  file.json[l] ...      Render existing exports; input format is auto-detected
  ls [directory]        List recent sessions without prompting or exporting
                        Run oc-export ls --help for filters and JSON output

Shared options:
${shared}

Export and render options:
  --session <id>      Full session ID or unique last 8 characters; no input files
  --output <path>     Output base path; accepts one file, --session, or the picker
  --raw              Skip HTML sanitization
  --no-raw           Enable HTML sanitization (default); overrides config raw: true
  --summarize        Summarize thinking and tool calls; requires the llm CLI and
                     summarize.enabled: true plus summarize.model in config

Output files:
  Session export: session-<last8>.jsonl and session-<last8>.html in this directory.
  File input: HTML beside each input file; the input file is not changed.
  --output report: report.jsonl + report.html for sessions; report.html for files.
  Related child sessions may produce additional files. Existing outputs can be overwritten.
  Sanitization applies to HTML; exported JSONL retains the original session data.
  OpenCode sources require the opencode CLI to export sessions.

${config}

Examples (after publication, or use oc-export when installed globally):
  npx oc-export --help
  npx oc-export --extractor codex
  npx oc-export ls --extractor codex --json
  npx oc-export --extractor codex --session SESSION_ID --output report
  npx oc-export session.jsonl
  npx oc-export session.json --output report
  npx oc-export --config ./config.jsonc ls

For scripts and agents: use ls --json, then replace SESSION_ID with a returned full ID.
Fish session completion is available in completions/oc-export.fish.
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
      return args.command === "ls" ? { help: true, command: "ls" } : { help: true };
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

      case "--limit": {
        const value = takeValue();
        if (!value || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
          return { help: false, error: "--limit requires a positive safe integer" };
        }
        args.limit = Number(value);
        break;
      }

      case "--all":
      case "--json-extended":
      case "--json":
      case "--raw":
      case "--no-raw":
      case "--summarize": {
        if (inlineValue !== undefined) {
          return { help: false, error: `${flag} does not accept a value` };
        }
        if (flag === "--all") args.all = true;
        else if (flag === "--json-extended") args.jsonExtended = true;
        else if (flag === "--json") args.json = true;
        else if (flag === "--raw") args.raw = true;
        else if (flag === "--no-raw") args.raw = false;
        else args.summarize = true;
        break;
      }

      default:
        if (flag.startsWith("-")) {
          return { help: false, error: `Unknown option ${flag}` };
        }
        if (arg === "ls" && args.files.length === 0 && args.command === undefined) {
          args.command = "ls";
        } else {
          args.files.push(arg);
        }
    }
  }

  if (args.command === "ls") {
    if (args.files.length > 1) {
      return { help: false, error: "ls accepts at most one directory" };
    }
    if (
      args.session !== undefined ||
      args.output !== undefined ||
      args.summarize !== undefined ||
      args.raw !== undefined
    ) {
      return {
        help: false,
        error: "ls cannot be combined with --session, --output, --summarize, --raw, or --no-raw",
      };
    }
    args.directory = args.files[0];
    args.files = [];
  }

  if (args.all && args.limit !== undefined) {
    return { help: false, error: "--all and --limit cannot be combined" };
  }
  if (args.json && args.jsonExtended) {
    return { help: false, error: "--json and --json-extended cannot be combined" };
  }
  if ((args.all || args.limit !== undefined || args.jsonExtended) && args.command !== "ls") {
    return { help: false, error: "--all, --limit, and --json-extended are only available with ls" };
  }
  if (args.json && args.command !== "ls") {
    return { help: false, error: "--json is only available with ls" };
  }

  return { help: false, args };
}
