import {
  CubeIcon,
  HashIcon,
  type IconWeight,
  LockSimpleIcon,
} from "@phosphor-icons/react";
import { PERSONAL_CHANNEL_NAME } from "@posthog/ui/features/canvas/hooks/useTaskChannels";
import type { ReactNode } from "react";

/**
 * Whether only its own members can see a channel.
 *
 * The personal "#me" channel is the only one today — it is per-user and can't
 * be shared. Channel names arrive server-normalized (lowercase-dashed), so a
 * case-insensitive match is enough; `Channel` carries no general privacy flag,
 * so this is the one place that has to learn about it when one lands.
 */
export function isPrivateChannel(channelName: string | undefined): boolean {
  if (!channelName) return false;
  return channelName.trim().toLowerCase() === PERSONAL_CHANNEL_NAME;
}

/**
 * A channel's leading glyph: a lock when it's private, otherwise a cube for the
 * Spaces layout or a hash for legacy Channels.
 */
export function channelGlyph(
  channelName: string | undefined,
  opts?: {
    size?: number;
    className?: string;
    weight?: IconWeight;
    space?: boolean;
  },
): ReactNode {
  const Icon = isPrivateChannel(channelName)
    ? LockSimpleIcon
    : opts?.space
      ? CubeIcon
      : HashIcon;
  return (
    <Icon
      size={opts?.size ?? 16}
      weight={opts?.weight}
      className={opts?.className}
    />
  );
}
