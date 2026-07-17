import { teamAvatarThumbUrl } from "@posthog/core/canvas/teamProfiles";
import { Avatar, AvatarFallback, AvatarImage } from "@posthog/quill";
import type { UserBasic } from "@posthog/shared/domain-types";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import { useTeamAvatarUrl } from "@posthog/ui/features/canvas/hooks/useTeamAvatars";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";

/**
 * A teammate's avatar: their posthog.com/people photo when the account maps
 * to a staff profile, initials otherwise (and while the photo loads).
 */
export function TeamMemberAvatar({
  user,
  size,
  className,
}: {
  user: UserBasic | null | undefined;
  size?: "lg" | "default" | "sm" | "xs";
  className?: string;
}) {
  const avatarUrl = useTeamAvatarUrl(user);
  return (
    <Avatar size={size} className={className}>
      {avatarUrl && (
        <AvatarImage
          src={teamAvatarThumbUrl(avatarUrl)}
          alt={userDisplayName(user)}
        />
      )}
      <AvatarFallback>{getUserInitials(user)}</AvatarFallback>
    </Avatar>
  );
}
