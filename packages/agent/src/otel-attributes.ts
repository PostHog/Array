const MAX_BODY_CHARS = 2000;
// PostHog Logs only facets attribute key/value pairs shorter than 256 chars,
// so free-text attribute values are capped well below that.
const MAX_ATTR_CHARS = 200;

export type AttributeValue = string | number | boolean;
export type Attributes = Record<string, AttributeValue>;

export { MAX_ATTR_CHARS, MAX_BODY_CHARS };

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function strAttr(
  attrs: Attributes,
  key: string,
  value: unknown,
  max = MAX_ATTR_CHARS,
): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  const truncated = truncate(value, max);
  attrs[key] = truncated;
  return truncated;
}

export function numAttr(attrs: Attributes, key: string, value: unknown): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    attrs[key] = value;
  }
}

export function usageAttributes(params: Record<string, unknown>): Attributes {
  const attrs: Attributes = {};
  const used = asRecord(params.used);
  if (used) {
    numAttr(attrs, "tokens_input", used.inputTokens);
    numAttr(attrs, "tokens_output", used.outputTokens);
    numAttr(attrs, "tokens_cached_read", used.cachedReadTokens);
    numAttr(attrs, "tokens_cached_write", used.cachedWriteTokens);
  }
  // Claude sends a plain number; other shapes carry { amount }.
  const cost =
    typeof params.cost === "number"
      ? params.cost
      : asRecord(params.cost)?.amount;
  numAttr(attrs, "cost_usd", cost);
  return attrs;
}

/** Timestamp of a stored entry as a Date, falling back to now when invalid. */
export function entryTime(timestamp: string): Date {
  const parsed = new Date(timestamp);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}
