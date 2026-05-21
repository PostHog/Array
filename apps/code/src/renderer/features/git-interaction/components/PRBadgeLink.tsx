import {
  getPrVisualConfig,
  parsePrNumber,
} from "@features/git-interaction/utils/prStatus";
import { Button, Flex, Spinner, Text } from "@radix-ui/themes";

interface PRBadgeLinkProps {
  prUrl: string;
  prState: string;
  merged: boolean;
  draft: boolean;
  isPrPending?: boolean;
  /**
   * When true, flatten the right edge so a dropdown trigger button can sit
   * flush against this badge (used by TaskActionsMenu's combined control).
   */
  attachedRight?: boolean;
}

/**
 * The colored "open this PR on GitHub" badge — a Radix soft button styled
 * by the PR's lifecycle state (open / draft / closed / merged) and
 * rendered as an external anchor. Shared between the task header
 * (TaskActionsMenu) and the command center cell header.
 */
export function PRBadgeLink({
  prUrl,
  prState,
  merged,
  draft,
  isPrPending = false,
  attachedRight = false,
}: PRBadgeLinkProps) {
  const config = getPrVisualConfig(prState, merged, draft);
  const prNumber = parsePrNumber(prUrl);

  return (
    <Button
      size="1"
      variant="soft"
      color={config.color}
      asChild
      style={
        attachedRight
          ? { borderTopRightRadius: 0, borderBottomRightRadius: 0 }
          : undefined
      }
    >
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
      >
        <Flex align="center" gap="2">
          {isPrPending ? <Spinner size="1" /> : config.icon}
          <Text size="1">
            {config.label}
            {prNumber && ` #${prNumber}`}
          </Text>
        </Flex>
      </a>
    </Button>
  );
}
