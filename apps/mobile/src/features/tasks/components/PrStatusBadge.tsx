import { getPrVisualConfig } from "@posthog/core/git-interaction/prStatus";
import { GitMerge, GitPullRequest } from "phosphor-react-native";
import { Pressable } from "react-native";
import { openExternalUrl } from "@/lib/openExternalUrl";
import { toRgba, useThemeColors } from "@/lib/theme";
import { usePrStatus } from "../hooks/usePrStatus";

interface PrStatusBadgeProps {
  prUrl: string;
  // Render nothing until the PR state resolves, and only for a canonical
  // GitHub PR URL. Inbox surfaces use this so an always-on neutral icon never
  // implies a status we couldn't confirm (private repo, 404, unparseable URL).
  hideWhenUnresolved?: boolean;
  size?: "sm" | "md";
}

export function PrStatusBadge({
  prUrl,
  hideWhenUnresolved = false,
  size = "md",
}: PrStatusBadgeProps) {
  const themeColors = useThemeColors();
  const { data: status } = usePrStatus(prUrl);

  if (hideWhenUnresolved && !status) return null;

  const handlePress = () => {
    openExternalUrl(prUrl);
  };

  const visual = getPrVisualConfig(
    status?.state ?? "open",
    status?.merged ?? false,
    status?.draft ?? false,
  );
  const colorByTone = {
    gray: themeColors.gray[11],
    green: themeColors.status.success,
    red: themeColors.status.error,
    purple: themeColors.status.merged,
  } satisfies Record<typeof visual.color, string>;
  const color = colorByTone[visual.color];
  const Icon = visual.icon === "merged" ? GitMerge : GitPullRequest;
  const label =
    visual.label === "Open"
      ? "Open PR"
      : `Open ${visual.label.toLowerCase()} PR`;

  const box = size === "sm" ? "h-7 w-7" : "h-9 w-9";
  const iconSize = size === "sm" ? 16 : 20;

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={10}
      className={`${box} items-center justify-center rounded-lg border active:opacity-60`}
      style={{
        backgroundColor: toRgba(color, 0.12),
        borderColor: toRgba(color, 0.35),
      }}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      <Icon size={iconSize} weight="bold" color={color} />
    </Pressable>
  );
}
