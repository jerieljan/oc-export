import type { SessionMeta, Turn } from "../types.js";
import { claudeExtractor } from "./claude.js";
import { kagiExtractor } from "./kagi.js";
import { opencodeExtractor } from "./opencode.js";
import { opencode2Extractor } from "./opencode2.js";
import { openWebUIExtractor } from "./openwebui.js";
import { piExtractor } from "./pi.js";
import type { Extractor } from "./types.js";

const extractors: Extractor[] = [
  openWebUIExtractor,
  kagiExtractor,
  piExtractor,
  claudeExtractor,
  opencode2Extractor,
  opencodeExtractor,
];

// Register a new extractor. Extractors registered later are tried first so
// more specific matchers can win over the built-in fallback.
export function registerExtractor(extractor: Extractor): void {
  extractors.unshift(extractor);
}

export function getExtractors(): readonly Extractor[] {
  return extractors;
}

// Attempt to extract a canonical session from raw parsed JSON. Each registered
// extractor is tried in order until one reports it can handle the data.
export function extractSession(data: unknown): {
  meta: SessionMeta;
  turns: Turn[];
} {
  for (const extractor of extractors) {
    if (extractor.canExtract(data)) {
      return extractor.extract(data);
    }
  }

  throw new Error(
    "No registered extractor can handle this JSON format. " +
      "Supported formats: " +
      (extractors.map((e) => e.label).join(", ") || "none"),
  );
}
