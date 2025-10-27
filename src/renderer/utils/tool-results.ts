export function parseStringListResult(result: unknown): string[] {
  if (!result) return [];

  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // If JSON parsing fails, split by newlines
      return result.split("\n").filter(Boolean);
    }
  }

  if (Array.isArray(result)) {
    return result;
  }

  return [];
}

export function truncateList(
  items: string[],
  maxCount: number,
  separator = "\n",
): string {
  const truncated = items.slice(0, maxCount);
  const remaining = items.length - maxCount;

  if (remaining > 0) {
    return `${truncated.join(separator)}${separator}... and ${remaining} more`;
  }

  return truncated.join(separator);
}
