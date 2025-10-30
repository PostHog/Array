/**
 * Utility functions for safely extracting values from unknown tool argument objects.
 * These replace repetitive typeof checks throughout tool view components.
 */

export function getString(
  args: Record<string, unknown>,
  key: string,
  defaultValue = "",
): string {
  const value = args[key];
  return typeof value === "string" ? value : defaultValue;
}

export function getStringOrUndefined(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

export function getNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = args[key];
  return typeof value === "number" ? value : undefined;
}

export function getBoolean(
  args: Record<string, unknown>,
  key: string,
  defaultValue = false,
): boolean {
  const value = args[key];
  return typeof value === "boolean" ? value : defaultValue;
}

export function getBooleanOrUndefined(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}
