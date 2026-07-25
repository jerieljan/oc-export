import type { SessionMeta, Turn } from "../types.js";

// An extractor converts a raw JSON blob into the canonical session model.
// Register additional extractors in src/extractors/index.ts to support new
// JSON file formats.
export interface Extractor {
  name: string;
  label: string;
  canExtract(data: unknown): boolean;
  extract(data: unknown): { meta: SessionMeta; turns: Turn[] };
}
