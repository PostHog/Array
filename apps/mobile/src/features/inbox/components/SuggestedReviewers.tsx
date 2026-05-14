import { Text } from "@components/text";
import { Eye } from "phosphor-react-native";
import { Image, Linking, Pressable, ScrollView, View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import type { SuggestedReviewer } from "../types";

interface SuggestedReviewersProps {
  reviewers: SuggestedReviewer[];
  meUuid?: string | null;
}

export function SuggestedReviewers({
  reviewers,
  meUuid,
}: SuggestedReviewersProps) {
  const themeColors = useThemeColors();
  if (reviewers.length === 0) return null;

  return (
    <View className="mb-4">
      <Text className="mb-2 font-semibold text-[12px] text-gray-10 uppercase tracking-wide">
        Suggested reviewers
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {reviewers.map((reviewer) => {
          const isMe =
            !!reviewer.user?.uuid && !!meUuid && reviewer.user.uuid === meUuid;
          const displayName =
            reviewer.user?.first_name ??
            reviewer.github_name ??
            reviewer.github_login;
          return (
            <Pressable
              key={reviewer.github_login}
              onPress={() =>
                Linking.openURL(`https://github.com/${reviewer.github_login}`)
              }
              hitSlop={4}
              className="flex-row items-center gap-2 rounded-full border border-gray-6 bg-gray-2 py-1.5 pr-3 pl-1.5 active:opacity-70"
            >
              <Image
                source={{
                  uri: `https://github.com/${reviewer.github_login}.png?size=48`,
                }}
                className="h-6 w-6 rounded-full bg-gray-4"
              />
              <Text className="text-[13px] text-gray-12">{displayName}</Text>
              {isMe && (
                <View className="rounded bg-status-warning/20 px-1 py-0.5">
                  <Eye
                    size={10}
                    color={themeColors.status.warning}
                    weight="bold"
                  />
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
