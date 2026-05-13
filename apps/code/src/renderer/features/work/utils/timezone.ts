/**
 * Returns the user's local IANA timezone, e.g. "America/New_York".
 * Falls back to "UTC" if the runtime can't resolve it.
 */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
