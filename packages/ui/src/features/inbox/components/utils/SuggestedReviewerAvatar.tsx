import { cn } from "@posthog/quill";

const SIZE = {
  sm: { className: "h-[18px] w-[18px]", pixels: 28 },
  md: { className: "h-[20px] w-[20px]", pixels: 32 },
} as const;

interface SuggestedReviewerAvatarProps {
  githubLogin: string;
  size?: keyof typeof SIZE;
  className?: string;
}

/** GitHub profile avatar for suggested reviewers – matches SuggestedReviewersEditor. */
export function SuggestedReviewerAvatar({
  githubLogin,
  size = "md",
  className,
}: SuggestedReviewerAvatarProps) {
  const config = SIZE[size];

  return (
    <img
      src={`https://github.com/${githubLogin}.png?size=${config.pixels}`}
      alt=""
      className={cn(
        "github-avatar shrink-0 rounded-full",
        config.className,
        className,
      )}
      onLoad={(event) => event.currentTarget.classList.add("loaded")}
    />
  );
}
