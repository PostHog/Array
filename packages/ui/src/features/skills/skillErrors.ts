import { getErrorMessage } from "@posthog/shared";

/**
 * The skills write endpoints throw plain Errors whose messages cross the
 * tRPC IPC boundary as strings, so conflict detection is centralized
 * message matching rather than instanceof checks.
 */
export function isSkillExistsError(error: unknown): boolean {
  return getErrorMessage(error).includes("already exists");
}

/** Toast-friendly error description: the message, or nothing. */
export function skillErrorDescription(error: unknown): string | undefined {
  return getErrorMessage(error) || undefined;
}
