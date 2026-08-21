import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import stripJsonComments from "strip-json-comments";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const schemaPath = path.join(__dirname, "..", "schemas", "config-schema.json");
const examplePath = path.join(__dirname, "..", "config-example.jsonc");

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const example = JSON.parse(stripJsonComments(fs.readFileSync(examplePath, "utf-8")));

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const validate = ajv.compile(schema);

let failed = false;

if (!validate(example)) {
  console.error("config-example.jsonc failed validation:");
  for (const error of validate.errors!) {
    console.error(`  ${error.instancePath || "(root)"}: ${error.message}`);
  }
  failed = true;
}

const invalidCases = [
  { raw: "not a boolean" },
  { extractor: "unknown" },
  { summarize: { model: "gpt-4o-mini" } },
  { navigation: { minTurns: -1 } },
];

for (const invalid of invalidCases) {
  if (validate(invalid)) {
    console.error("Expected invalid config to fail validation:", invalid);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

console.log("config-example.jsonc is valid and the schema rejects invalid cases.");
