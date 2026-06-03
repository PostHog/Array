import { Text } from "@components/text";
import { Check } from "phosphor-react-native";
import { useMemo } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useUserQuery } from "@/features/auth";
import { useScreenInsets } from "@/hooks/useScreenInsets";
import { useThemeColors } from "@/lib/theme";
import { useAvailableSuggestedReviewers } from "../hooks/useInboxReports";
import { useInboxFilterStore } from "../stores/inboxFilterStore";
import type { AvailableSuggestedReviewer } from "../types";

interface ReviewerFilterSheetProps {
  visible: boolean;
  onClose: () => void;
}

interface ReviewerOption {
  uuid: string;
  name: string;
  email: string;
  github_login: string;
  isMe: boolean;
}

function buildReviewerOptions(
  reviewers: AvailableSuggestedReviewer[],
  currentUserUuid: string | undefined,
): ReviewerOption[] {
  const seen = new Set<string>();
  const options: ReviewerOption[] = [];

  for (const r of reviewers) {
    if (!r.uuid || seen.has(r.uuid)) continue;
    seen.add(r.uuid);
    options.push({
      uuid: r.uuid,
      name: r.name?.trim() || "",
      email: r.email?.trim() || "",
      github_login: r.github_login?.trim() || "",
      isMe: r.uuid === currentUserUuid,
    });
  }

  // Sort: "Me" first, then alphabetical by name
  options.sort((a, b) => {
    if (a.isMe && !b.isMe) return -1;
    if (!a.isMe && b.isMe) return 1;
    return (a.name || a.email).localeCompare(b.name || b.email);
  });

  return options;
}

function displayName(r: ReviewerOption): string {
  const base = r.name || r.email || "Unknown user";
  return r.isMe ? `${base} (Me)` : base;
}

export function ReviewerFilterSheet({
  visible,
  onClose,
}: ReviewerFilterSheetProps) {
  const { bottom, sheetContentTop } = useScreenInsets();
  const themeColors = useThemeColors();
  const { data: currentUser } = useUserQuery();
  const { data: available, isLoading } = useAvailableSuggestedReviewers();

  const suggestedReviewerFilter = useInboxFilterStore(
    (s) => s.suggestedReviewerFilter,
  );
  const toggleSuggestedReviewer = useInboxFilterStore(
    (s) => s.toggleSuggestedReviewer,
  );
  const setSuggestedReviewerFilter = useInboxFilterStore(
    (s) => s.setSuggestedReviewerFilter,
  );

  const options = useMemo(
    () => buildReviewerOptions(available?.results ?? [], currentUser?.uuid),
    [available?.results, currentUser?.uuid],
  );

  const hasSelection = suggestedReviewerFilter.length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: sheetContentTop() }}
      >
        {/* Header */}
        <View className="flex-row items-center justify-between border-gray-6 border-b px-4 pb-3">
          <Text className="font-semibold text-[18px] text-gray-12">
            Suggested Reviewer
          </Text>
          <View className="flex-row items-center gap-3">
            {hasSelection && (
              <Pressable onPress={() => setSuggestedReviewerFilter([])}>
                <Text className="text-[14px] text-accent-9">Clear</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose}>
              <Text className="font-semibold text-[14px] text-accent-9">
                Done
              </Text>
            </Pressable>
          </View>
        </View>

        {isLoading && options.length === 0 ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={themeColors.accent[9]} />
          </View>
        ) : options.length === 0 ? (
          <View className="flex-1 items-center justify-center p-6">
            <Text className="text-[14px] text-gray-10">No reviewers found</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: bottom("roomy"),
            }}
          >
            {options.map((reviewer, index) => {
              const isSelected = suggestedReviewerFilter.includes(
                reviewer.uuid,
              );
              const showDivider = reviewer.isMe && index < options.length - 1;

              return (
                <View key={reviewer.uuid}>
                  <Pressable
                    onPress={() => toggleSuggestedReviewer(reviewer.uuid)}
                    className="flex-row items-center justify-between rounded-md px-2 py-2.5 active:bg-gray-3"
                  >
                    <View className="min-w-0 flex-1 flex-row items-center gap-2.5">
                      {reviewer.github_login ? (
                        <Image
                          source={{
                            uri: `https://github.com/${reviewer.github_login}.png?size=32`,
                          }}
                          className="h-6 w-6 rounded-full bg-gray-4"
                        />
                      ) : (
                        <View className="h-6 w-6 items-center justify-center rounded-full bg-gray-4">
                          <Text className="text-[11px] text-gray-10">
                            {(reviewer.name ||
                              reviewer.email ||
                              "?")[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View className="min-w-0 flex-1">
                        <Text
                          className="text-[14px] text-gray-12"
                          numberOfLines={1}
                        >
                          {displayName(reviewer)}
                        </Text>
                        {reviewer.email && (
                          <Text
                            className="text-[12px] text-gray-9"
                            numberOfLines={1}
                          >
                            {reviewer.email}
                          </Text>
                        )}
                      </View>
                    </View>
                    {isSelected && (
                      <Check size={16} color={themeColors.gray[12]} />
                    )}
                  </Pressable>
                  {showDivider && (
                    <View className="mx-2 my-1 border-gray-6 border-t" />
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
