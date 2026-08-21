import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import stripJsonComments from "strip-json-comments";
import { expandHome } from "./util.js";

export const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".config/oc-export/config.jsonc");

export interface PickerConfig {
  databasePath: string;
  limit: number;
}

export interface ClaudeConfig {
  projectsPath: string;
  limit: number;
}

export interface PiConfig {
  sessionsPath: string;
  limit: number;
}

export interface SessionSummaryConfig {
  enabled?: boolean;
  prompt?: string;
  collapsed?: boolean;
}

export interface SummarizeConfig {
  enabled: boolean;
  model?: string;
  always?: boolean;
  prompt?: string;
  thinkingPrompt?: string;
  toolsPrompt?: string;
  sessionSummary?: SessionSummaryConfig;
}

export interface NavigationConfig {
  enabled?: boolean;
  minTurns?: number;
  progressBar?: boolean;
  roleColor?: boolean;
}

/** NavigationConfig with every field resolved to its effective value. */
export type ResolvedNavigationConfig = Required<NavigationConfig>;

// Single owner of navigation defaults; the renderer consumes resolved values.
export function resolveNavigationConfig(navigation?: NavigationConfig): ResolvedNavigationConfig {
  return {
    enabled: navigation?.enabled ?? true,
    minTurns: navigation?.minTurns ?? 0,
    progressBar: navigation?.progressBar ?? true,
    roleColor: navigation?.roleColor ?? false,
  };
}

export interface UserConfig {
  raw?: boolean;
  extractor?: string;
  username?: string;
  picker?: Partial<PickerConfig>;
  claude?: Partial<ClaudeConfig>;
  pi?: Partial<PiConfig>;
  summarize?: SummarizeConfig;
  navigation?: NavigationConfig;
}

export interface ResolvedConfig {
  raw: boolean;
  extractor: string;
  username?: string;
  picker: PickerConfig;
  claude: ClaudeConfig;
  pi: PiConfig;
  summarize?: SummarizeConfig;
  navigation?: NavigationConfig;
}

export const DEFAULT_PICKER_CONFIG: PickerConfig = {
  databasePath: path.join(os.homedir(), ".local/share/opencode/opencode.db"),
  limit: 20,
};

export const DEFAULT_CLAUDE_CONFIG: ClaudeConfig = {
  projectsPath: path.join(os.homedir(), ".claude/projects"),
  limit: DEFAULT_PICKER_CONFIG.limit,
};

export const DEFAULT_PI_CONFIG: PiConfig = {
  sessionsPath: path.join(os.homedir(), ".pi/agent/sessions"),
  limit: DEFAULT_PICKER_CONFIG.limit,
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  raw: false,
  extractor: "opencode",
  picker: DEFAULT_PICKER_CONFIG,
  claude: DEFAULT_CLAUDE_CONFIG,
  pi: DEFAULT_PI_CONFIG,
};

function validateBoolean(value: unknown, key: string): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`Config error: "${key}" must be a boolean`);
  }
}

function validateString(value: unknown, key: string): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`Config error: "${key}" must be a string`);
  }
}

function validatePositiveNumber(value: unknown, key: string): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== "number" || value <= 0)) {
    throw new Error(`Config error: "${key}" must be a positive number`);
  }
}

function validateNonNegativeInteger(
  value: unknown,
  key: string,
): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== "number" || value < 0 || !Number.isInteger(value))) {
    throw new Error(`Config error: "${key}" must be a non-negative integer`);
  }
}

function validateUserConfig(config: UserConfig): ResolvedConfig {
  validateBoolean(config.raw, "raw");
  validateString(config.extractor, "extractor");
  validateString(config.username, "username");

  if (config.picker !== undefined && typeof config.picker !== "object") {
    throw new Error('Config error: "picker" must be an object');
  }

  validateString(config.picker?.databasePath, "picker.databasePath");
  validatePositiveNumber(config.picker?.limit, "picker.limit");

  if (config.claude !== undefined && typeof config.claude !== "object") {
    throw new Error('Config error: "claude" must be an object');
  }

  validateString(config.claude?.projectsPath, "claude.projectsPath");
  validatePositiveNumber(config.claude?.limit, "claude.limit");

  if (config.pi !== undefined && typeof config.pi !== "object") {
    throw new Error('Config error: "pi" must be an object');
  }

  validateString(config.pi?.sessionsPath, "pi.sessionsPath");
  validatePositiveNumber(config.pi?.limit, "pi.limit");

  if (config.summarize !== undefined && typeof config.summarize !== "object") {
    throw new Error('Config error: "summarize" must be an object');
  }

  if (config.summarize) {
    validateBoolean(config.summarize.enabled, "summarize.enabled");
    validateBoolean(config.summarize.always, "summarize.always");
    validateString(config.summarize.model, "summarize.model");
    validateString(config.summarize.prompt, "summarize.prompt");
    validateString(config.summarize.thinkingPrompt, "summarize.thinkingPrompt");
    validateString(config.summarize.toolsPrompt, "summarize.toolsPrompt");

    if (
      config.summarize.sessionSummary !== undefined &&
      typeof config.summarize.sessionSummary !== "object"
    ) {
      throw new Error('Config error: "summarize.sessionSummary" must be an object');
    }

    if (config.summarize.sessionSummary) {
      validateBoolean(config.summarize.sessionSummary.enabled, "summarize.sessionSummary.enabled");
      validateString(config.summarize.sessionSummary.prompt, "summarize.sessionSummary.prompt");
      validateBoolean(
        config.summarize.sessionSummary.collapsed,
        "summarize.sessionSummary.collapsed",
      );
    }
  }

  if (config.navigation !== undefined && typeof config.navigation !== "object") {
    throw new Error('Config error: "navigation" must be an object');
  }

  if (config.navigation) {
    validateBoolean(config.navigation.enabled, "navigation.enabled");
    validateNonNegativeInteger(config.navigation.minTurns, "navigation.minTurns");
    validateBoolean(config.navigation.progressBar, "navigation.progressBar");
    validateBoolean(config.navigation.roleColor, "navigation.roleColor");
  }

  const pickerLimit = config.picker?.limit ?? DEFAULT_PICKER_CONFIG.limit;

  return {
    raw: config.raw ?? DEFAULT_CONFIG.raw,
    extractor: config.extractor ?? DEFAULT_CONFIG.extractor,
    username: config.username,
    picker: {
      databasePath: config.picker?.databasePath
        ? expandHome(config.picker.databasePath)
        : DEFAULT_PICKER_CONFIG.databasePath,
      limit: pickerLimit,
    },
    claude: {
      projectsPath: config.claude?.projectsPath
        ? expandHome(config.claude.projectsPath)
        : DEFAULT_CLAUDE_CONFIG.projectsPath,
      limit: config.claude?.limit ?? pickerLimit,
    },
    pi: {
      sessionsPath: config.pi?.sessionsPath
        ? expandHome(config.pi.sessionsPath)
        : DEFAULT_PI_CONFIG.sessionsPath,
      limit: config.pi?.limit ?? pickerLimit,
    },
    summarize: config.summarize,
    navigation: config.navigation,
  };
}

// Returns a fresh copy of the defaults so callers can mutate the resolved
// config (e.g. overriding the extractor from a CLI flag) without affecting
// the shared DEFAULT_CONFIG object.
function freshDefaultConfig(): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    picker: { ...DEFAULT_CONFIG.picker },
    claude: { ...DEFAULT_CONFIG.claude },
    pi: { ...DEFAULT_CONFIG.pi },
  };
}

export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): ResolvedConfig {
  if (!fs.existsSync(configPath)) {
    return freshDefaultConfig();
  }

  let text: string;
  try {
    text = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    throw new Error(`Failed to read config file ${configPath}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(text));
  } catch (err) {
    throw new Error(`Failed to parse config file ${configPath}: ${(err as Error).message}`);
  }

  if (parsed !== null && typeof parsed !== "object") {
    throw new Error(`Config error: ${configPath} must contain a JSON object`);
  }

  return validateUserConfig(parsed as UserConfig);
}
