import type { Source } from "./types.js";
import { claudeSource } from "./claude.js";
import { opencodeSource } from "./opencode.js";
import { piSource } from "./pi.js";

const sources: Source[] = [opencodeSource, claudeSource, piSource];

export function registerSource(source: Source): void {
  sources.unshift(source);
}

export function getSources(): readonly Source[] {
  return sources;
}

export function getSource(name: string): Source {
  const source = sources.find((s) => s.name === name);
  if (!source) {
    throw new Error(
      `Unknown extractor/source: ${name}. ` +
        `Supported: ${sources.map((s) => s.name).join(", ")}`,
    );
  }
  return source;
}

export { opencodeSource, claudeSource };
export type { Source, SourceOptions } from "./types.js";
