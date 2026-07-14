/**
 * Stand-in for posthog's `lib/utils/copyToClipboard`, without the lemon toast
 * notifications. Same signature and boolean result as upstream.
 */
export async function copyToClipboard(
  value: string,
  _description: string = "text",
): Promise<boolean> {
  if (!navigator.clipboard) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
