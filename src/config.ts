import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import stripJsonComments from "strip-json-comments";

export const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  ".config/oc-export/config.jsonc",
);

export interface PickerConfig {
  databasePath: string;
  limit: number;
}

export interface ClaudeConfig {
  projectsPath: string;
  limit: number;
}

export interface SummarizeConfig {
  enabled: boolean;
  model?: string;
  always?: boolean;
  prompt?: string;
  thinkingPrompt?: string;
  toolsPrompt?: string;
}

export interface NavigationConfig {
  enabled?: boolean;
  minTurns?: number;
  progressBar?: boolean;
  roleColor?: boolean;
}

export interface UserConfig {
  raw?: boolean;
  extractor?: string;
  username?: string;
  picker?: Partial<PickerConfig>;
  claude?: Partial<ClaudeConfig>;
  summarize?: SummarizeConfig;
  navigation?: NavigationConfig;
}

export interface ResolvedConfig {
  raw: boolean;
  extractor: string;
  username?: string;
  picker: PickerConfig;
  claude: ClaudeConfig;
  summarize?: SummarizeConfig;
  navigation?: NavigationConfig;
}

export const DEFAULT_PICKER_CONFIG: PickerConfig = {
  databasePath: path.join(
    os.homedir(),
    ".local/share/opencode/opencode.db",
  ),
  limit: 20,
};

export const DEFAULT_CLAUDE_CONFIG: ClaudeConfig = {
  projectsPath: path.join(os.homedir(), ".claude/projects"),
  limit: 50,
};

export const DEFAULT_CONFIG: ResolvedConfig = {
  raw: false,
  extractor: "opencode",
  picker: DEFAULT_PICKER_CONFIG,
  claude: DEFAULT_CLAUDE_CONFIG,
};

function expandHomeDir(inputPath: string): string {
  if (inputPath.startsWith("~/") || inputPath === "~") {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}

function validateBoolean(
  value: unknown,
  key: string,
): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new Error(`Config error: "${key}" must be a boolean`);
  }
}

function validateString(
  value: unknown,
  key: string,
): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`Config error: "${key}" must be a string`);
  }
}

function validatePositiveNumber(
  value: unknown,
  key: string,
): asserts value is number | undefined {
  if (value !== undefined && (typeof value !== "number" || value <= 0)) {
    throw new Error(`Config error: "${key}" must be a positive number`);
  }
}

function validateNonNegativeInteger(
  value: unknown,
  key: string,
): asserts value is number | undefined {
  if (
    value !== undefined &&
    (typeof value !== "number" || value < 0 || !Number.isInteger(value))
  ) {
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

  return {
    raw: config.raw ?? DEFAULT_CONFIG.raw,
    extractor: config.extractor ?? DEFAULT_CONFIG.extractor,
    username: config.username,
    picker: {
      databasePath: config.picker?.databasePath
        ? expandHomeDir(config.picker.databasePath)
        : DEFAULT_PICKER_CONFIG.databasePath,
      limit: config.picker?.limit ?? DEFAULT_PICKER_CONFIG.limit,
    },
    claude: {
      projectsPath: config.claude?.projectsPath
        ? expandHomeDir(config.claude.projectsPath)
        : DEFAULT_CLAUDE_CONFIG.projectsPath,
      limit: config.claude?.limit ?? DEFAULT_CLAUDE_CONFIG.limit,
    },
    summarize: config.summarize,
    navigation: config.navigation,
  };
}

export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): ResolvedConfig {
  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  let text: string;
  try {
    text = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read config file ${configPath}: ${(err as Error).message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonComments(text));
  } catch (err) {
    throw new Error(
      `Failed to parse config file ${configPath}: ${(err as Error).message}`,
    );
  }

  if (parsed !== null && typeof parsed !== "object") {
    throw new Error(
      `Config error: ${configPath} must contain a JSON object`,
    );
  }

  return validateUserConfig(parsed as UserConfig);
}
