import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import stripJsonComments from "strip-json-comments";
import { loadConfig } from "../src/config.js";
import { getSources } from "../src/sources/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const schemaPath = path.join(__dirname, "..", "schemas", "config-schema.json");
const examplePath = path.join(__dirname, "..", "config-example.jsonc");

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const example = JSON.parse(stripJsonComments(fs.readFileSync(examplePath, "utf-8")));

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const validate = ajv.compile(schema);

let failed = false;

function fail(message: string): void {
  console.error(message);
  failed = true;
}

if (!validate(example)) {
  fail("config-example.jsonc failed validation:");
  for (const error of validate.errors!) {
    console.error(`  ${error.instancePath || "(root)"}: ${error.message}`);
  }
}

const invalidCases = [
  { raw: "not a boolean" },
  { extractor: "unknown" },
  { summarize: { enabled: true } },
  { navigation: { minTurns: -1 } },
];

for (const invalid of invalidCases) {
  if (validate(invalid)) {
    fail(`Expected invalid config to fail validation: ${JSON.stringify(invalid)}`);
  }
}

// Drift check 1: the schema's extractor enum must match the registered
// sources, so adding or renaming a source cannot leave the schema stale.
const schemaEnum: string[] = schema.properties?.extractor?.enum ?? [];
const sourceNames = getSources()
  .map((source) => source.name)
  .sort();
if (JSON.stringify([...schemaEnum].sort()) !== JSON.stringify(sourceNames)) {
  fail(
    `Schema extractor enum ${JSON.stringify(schemaEnum)} does not match registered sources ` +
      `${JSON.stringify(sourceNames)}. Update schemas/config-schema.json.`,
  );
}

// Drift check 2: a kitchen-sink config must validate against the schema AND
// load through loadConfig with the expected resolved values. A key present in
// one place but not the other surfaces here.
const kitchenSink = {
  raw: true,
  extractor: sourceNames.includes("opencode2") ? "opencode2" : sourceNames[0],
  username: "Tester",
  picker: { databasePath: "~/sessions/db.sqlite", limit: 5 },
  claude: { projectsPath: "~/claude", limit: 7 },
  pi: { sessionsPath: "~/pi", limit: 9 },
  summarize: {
    enabled: true,
    model: "gpt-4o-mini",
    always: true,
    prompt: "fallback prompt",
    thinkingPrompt: "thinking prompt",
    toolsPrompt: "tools prompt",
    sessionSummary: { enabled: true, prompt: "session prompt", collapsed: false },
  },
  navigation: { enabled: true, minTurns: 3, progressBar: false, roleColor: true },
};

if (!validate(kitchenSink)) {
  fail("Kitchen-sink config failed schema validation (schema is missing keys?):");
  for (const error of validate.errors!) {
    console.error(`  ${error.instancePath || "(root)"}: ${error.message}`);
  }
}

let tempDir: string | null = null;
try {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-export-schema-"));
  const configPath = path.join(tempDir, "config.jsonc");
  fs.writeFileSync(configPath, JSON.stringify(kitchenSink, null, 2), "utf-8");
  const resolved = loadConfig(configPath);

  const expected: Array<[string, unknown, unknown]> = [
    ["raw", resolved.raw, true],
    ["extractor", resolved.extractor, kitchenSink.extractor],
    ["username", resolved.username, "Tester"],
    [
      "picker.databasePath",
      resolved.picker.databasePath,
      path.join(os.homedir(), "sessions/db.sqlite"),
    ],
    ["picker.limit", resolved.picker.limit, 5],
    ["claude.projectsPath", resolved.claude.projectsPath, path.join(os.homedir(), "claude")],
    ["claude.limit", resolved.claude.limit, 7],
    ["pi.sessionsPath", resolved.pi.sessionsPath, path.join(os.homedir(), "pi")],
    ["pi.limit", resolved.pi.limit, 9],
    ["summarize.model", resolved.summarize?.model, "gpt-4o-mini"],
    ["summarize.sessionSummary.collapsed", resolved.summarize?.sessionSummary?.collapsed, false],
    ["navigation.minTurns", resolved.navigation?.minTurns, 3],
    ["navigation.progressBar", resolved.navigation?.progressBar, false],
    ["navigation.roleColor", resolved.navigation?.roleColor, true],
  ];

  for (const [key, actual, wanted] of expected) {
    if (actual !== wanted) {
      fail(
        `loadConfig mismatch for "${key}": expected ${JSON.stringify(wanted)}, got ${JSON.stringify(actual)}`,
      );
    }
  }
} finally {
  if (tempDir) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (failed) {
  process.exit(1);
}

console.log(
  "config-example.jsonc is valid; the schema rejects invalid cases and matches the loader.",
);
