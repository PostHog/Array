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

function parseToolResult<TResult>(
  result: string | Partial<TResult> | undefined,
  defaults: TResult,
  stringParser?: (str: string) => Partial<TResult>,
): TResult {
  if (!result) {
    return defaults;
  }

  if (typeof result === "string") {
    const stringResult =
      stringParser?.(result) ??
      ({ stdout: result } as unknown as Partial<TResult>);
    return { ...defaults, ...stringResult };
  }

  return { ...defaults, ...result };
}

export interface ShellResult {
  stdout: string;
  stderr: string;
  exitCode?: number;
}

export function parseShellResult(
  result: string | Partial<ShellResult> | undefined,
): ShellResult {
  return parseToolResult(result, { stdout: "", stderr: "" });
}

export interface ShellStatusResult {
  stdout: string;
  stderr: string;
  status?: string;
}

export function parseShellStatusResult(
  result: string | Partial<ShellStatusResult> | undefined,
): ShellStatusResult {
  return parseToolResult(result, { stdout: "", stderr: "" });
}

export interface KillShellResult {
  success: boolean;
  message: string;
}

export function parseKillShellResult(
  result: string | Partial<KillShellResult> | undefined,
): KillShellResult {
  return parseToolResult(result, { success: false, message: "" }, (str) => ({
    success: str.includes("killed") || str.includes("terminated"),
    message: str,
  }));
}

export interface GrepResultParsed {
  matches: string[];
  count?: number;
}

export function parseGrepResult(
  result: string | Partial<GrepResultParsed> | undefined,
): GrepResultParsed {
  return parseToolResult(result, { matches: [] }, (str) => ({
    matches: parseStringListResult(str),
  }));
}

export function parseWebSearchResult<T>(
  result: string | { results?: T[] } | undefined,
): T[] {
  if (!result) return [];

  if (typeof result === "string") {
    try {
      const parsed = JSON.parse(result);
      return parsed.results || [];
    } catch {
      return [];
    }
  }

  return result.results || [];
}
