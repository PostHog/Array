export interface BackoffOptions {
  initialDelayMs: number;
  maxDelayMs?: number;
  multiplier?: number;
}

/**
 * Calculate delay for exponential backoff
 * @param attempt - Zero-indexed attempt number (0 = first retry)
 * @param options - Backoff configuration
 * @returns Delay in milliseconds
 */
export function getBackoffDelay(
  attempt: number,
  options: BackoffOptions,
): number {
  const { initialDelayMs, maxDelayMs, multiplier = 2 } = options;
  const delay = initialDelayMs * multiplier ** attempt;
  return maxDelayMs ? Math.min(delay, maxDelayMs) : delay;
}

/**
 * Sleep with exponential backoff delay
 */
export function sleepWithBackoff(
  attempt: number,
  options: BackoffOptions,
): Promise<void> {
  const delay = getBackoffDelay(attempt, options);
  return new Promise((resolve) => setTimeout(resolve, delay));
}
