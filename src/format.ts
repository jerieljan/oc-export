// Shared formatting helpers used by extractors and the renderer.

export function formatTimestamp(ms: number | undefined): string | undefined {
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
