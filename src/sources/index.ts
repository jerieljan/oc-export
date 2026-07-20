import type { Source } from "./types.ts";
import { claudeSource } from "./claude.ts";
import { opencodeSource } from "./opencode.ts";

const sources: Source[] = [opencodeSource, claudeSource];

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
export type { Source, SourceOptions } from "./types.ts";
