import { GithubLogoIcon, GitPullRequestIcon } from "@phosphor-icons/react";
import { Chip } from "@posthog/quill";
import type { ReactNode } from "react";

export function GithubRefChip({
  href,
  kind,
  children,
}: {
  href: string;
  kind: "issue" | "pr";
  children: ReactNode;
}) {
  const Icon = kind === "pr" ? GitPullRequestIcon : GithubLogoIcon;
  return (
    <Chip
      size="xs"
      onClick={() => window.open(href, "_blank")}
      className="cli-file-mention mx-0.5 max-w-full cursor-pointer! whitespace-nowrap pl-1 align-middle active:translate-y-0"
    >
      <Icon size={10} />
      <span className="min-w-0 truncate">{children}</span>
    </Chip>
  );
}
