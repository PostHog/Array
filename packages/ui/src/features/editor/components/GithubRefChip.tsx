import { GithubLogoIcon, GitPullRequestIcon } from "@phosphor-icons/react";
import { Chip } from "@posthog/quill";
import type { ReactNode } from "react";
import { useOpenUrl } from "../../../shell/useOpenUrl";

/**
 * DOM attribute carrying the chip's GitHub URL. The conversation context menu
 * reads it (via `closest()`) so "Copy" can copy the link of a right-clicked
 * chip, which is otherwise unreachable from a text selection.
 */
export const GITHUB_REF_URL_ATTR = "data-github-ref-url";

export function GithubRefChip({
  href,
  kind,
  children,
}: {
  href: string;
  kind: "issue" | "pr";
  children: ReactNode;
}) {
  const openUrl = useOpenUrl();
  const Icon = kind === "pr" ? GitPullRequestIcon : GithubLogoIcon;
  return (
    <Chip
      {...{ [GITHUB_REF_URL_ATTR]: href }}
      size="xs"
      onClick={() => openUrl(href)}
      className="cli-file-mention mx-0.5 max-w-full cursor-pointer! whitespace-nowrap pl-1 align-middle active:translate-y-0"
    >
      <Icon size={10} />
      <span className="min-w-0 truncate">{children}</span>
    </Chip>
  );
}
