// Shared formatting helpers used by extractors and the renderer.

export function parseTimestamp(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  const parsed = Date.parse(value);
  return isNaN(parsed) ? undefined : parsed;
}

export function formatTimestamp(
  value: string | number | undefined,
): string | undefined {
  const ms = parseTimestamp(value);
  if (ms === undefined) return undefined;
  return new Date(ms).toLocaleString();
}

export function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined) return undefined;
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes} min ${seconds} sec`;
  }
  return `${seconds} sec`;
}

export function formatCost(cost: number | undefined): string | undefined {
  if (cost === undefined) return undefined;
  return `$${cost.toFixed(5)}`;
}

export function formatTokens(value: number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.toLocaleString();
}
