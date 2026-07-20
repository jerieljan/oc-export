import type { SessionMeta, Turn } from "../types.ts";
import type { Extractor } from "./types.ts";
import { kagiExtractor } from "./kagi.ts";
import { opencodeExtractor } from "./opencode.ts";
import { openWebUIExtractor } from "./openwebui.ts";

const extractors: Extractor[] = [openWebUIExtractor, kagiExtractor, opencodeExtractor];

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
export function extractSession(data: unknown): { meta: SessionMeta; turns: Turn[] } {
  for (const extractor of extractors) {
    if (extractor.canExtract(data)) {
      return extractor.extract(data);
    }
  }

  throw new Error(
    "No registered extractor can handle this JSON format. " +
      "Supported formats: " +
      extractors.map((e) => e.label).join(", ") || "none",
  );
}
