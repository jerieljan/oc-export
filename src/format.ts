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

export function formatTimestampIsoWithTimezone(
  value: string | number | undefined,
): string | undefined {
  const ms = parseTimestamp(value);
  if (ms === undefined) return undefined;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absOffset = Math.abs(offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(absOffset / 60))}:${pad(absOffset % 60)}`;
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
