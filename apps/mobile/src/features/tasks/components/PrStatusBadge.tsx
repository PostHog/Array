import { GitMerge, GitPullRequest } from "phosphor-react-native";
import { Linking, Pressable } from "react-native";
import { toRgba, useThemeColors } from "@/lib/theme";
import { usePrStatus } from "../hooks/usePrStatus";

interface PrStatusBadgeProps {
  prUrl: string;
}

// Mirrors the desktop "merged" PR color (Radix purple-9 family). Theme tokens
// don't include a purple, and merged-PR purple is recognisable enough that a
// fixed value works in both light and dark.
const MERGED_COLOR = "#8e4ec6";

export function PrStatusBadge({ prUrl }: PrStatusBadgeProps) {
  const themeColors = useThemeColors();
  const { data: status } = usePrStatus(prUrl);

  const handlePress = () => {
    Linking.openURL(prUrl).catch(() => {});
  };

  let color: string = themeColors.gray[11];
  let Icon: typeof GitPullRequest = GitPullRequest;
  let label = "Open PR";

  if (status?.merged) {
    color = MERGED_COLOR;
    Icon = GitMerge;
    label = "Open merged PR";
  } else if (status?.state === "closed") {
    color = themeColors.status.error;
    label = "Open closed PR";
  } else if (status?.draft) {
    color = themeColors.gray[11];
    label = "Open draft PR";
  } else if (status?.state === "open") {
    color = themeColors.status.success;
    label = "Open PR";
  }

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={10}
      className="h-9 w-9 items-center justify-center rounded-lg border active:opacity-60"
      style={{
        backgroundColor: toRgba(color, 0.12),
        borderColor: toRgba(color, 0.35),
      }}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      <Icon size={20} weight="bold" color={color} />
    </Pressable>
  );
}
