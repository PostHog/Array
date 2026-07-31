import { useMeQuery } from "@posthog/ui/features/auth/useMeQuery";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";

/**
 * Display label for the personal ("me") space. We show the signed-in user's
 * own name so it's obvious these are *their* tasks rather than a space literally
 * called "me", which readers kept misreading.
 *
 * This only changes what's rendered — the channel is still identified, routed,
 * matched, and provisioned under {@link PERSONAL_CHANNEL_NAME} everywhere. Falls
 * back to that raw name until the (cached, fast) user record loads, or if the
 * user has no name set.
 */
export function usePersonalSpaceName(): string {
  const { data: user } = useMeQuery();
  const name = [user?.first_name, user?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return name || PERSONAL_CHANNEL_NAME;
}

/**
 * Maps a raw channel name to what should be shown for it, swapping the personal
 * channel's "me" for the user's name (see {@link usePersonalSpaceName}) and
 * leaving every other space's name untouched.
 */
export function useSpaceDisplayName(
  rawName: string | undefined,
): string | undefined {
  const personalName = usePersonalSpaceName();
  return rawName === PERSONAL_CHANNEL_NAME ? personalName : rawName;
}
