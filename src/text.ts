// Shared text helpers used by extractors and sources.

/** Join two content strings with a blank line, ignoring empty sides. */
export function joinContent(existing: string, addition: string): string {
  existing = existing.trim();
  addition = addition.trim();
  if (!existing) return addition;
  if (!addition) return existing;
  return `${existing}\n\n${addition}`;
}

/**
 * Undo the escaped-string encoding (\n, \t, \r, \", \', \\) found in stored
 * Claude Code message content.
 */
export function unescapeClaudeString(text: string): string {
  return text
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\r/g, "\r")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}
