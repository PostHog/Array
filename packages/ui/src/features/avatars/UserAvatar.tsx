import { Avatar, AvatarFallback, AvatarImage } from "@posthog/quill";
import { getUserInitials } from "@posthog/ui/features/auth/userInitials";
import {
  type AvatarUser,
  useUserAvatar,
} from "@posthog/ui/features/avatars/useUserAvatar";

/**
 * A user's avatar: their profile photo when one resolves, initials otherwise
 * (and while the photo loads — Gravatar's d=404 means accounts without one
 * simply never swap in an image).
 */
export function UserAvatar({
  user,
  size,
  className,
}: {
  user: AvatarUser | null | undefined;
  size?: "lg" | "default" | "sm" | "xs";
  className?: string;
}) {
  const avatarUrl = useUserAvatar(user);
  const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ");
  return (
    <Avatar size={size} className={className}>
      {avatarUrl && (
        <AvatarImage src={avatarUrl} alt={name || user?.email || ""} />
      )}
      <AvatarFallback>{getUserInitials(user)}</AvatarFallback>
    </Avatar>
  );
}
