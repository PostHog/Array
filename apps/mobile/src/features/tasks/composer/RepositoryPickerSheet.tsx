import { Text } from "@components/text";
import { Check, MagnifyingGlass } from "phosphor-react-native";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { RepositoryOption } from "@/features/tasks/types";
import { useThemeColors } from "@/lib/theme";

interface RepositoryPickerSheetProps {
  open: boolean;
  repositoryOptions: RepositoryOption[];
  selected: RepositoryOption | null;
  loading?: boolean;
  onChange: (option: RepositoryOption) => void;
  onClose: () => void;
}

export function RepositoryPickerSheet({
  open,
  repositoryOptions,
  selected,
  loading,
  onChange,
  onClose,
}: RepositoryPickerSheetProps) {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return repositoryOptions;
    return repositoryOptions.filter(
      (option) =>
        option.repository.toLowerCase().includes(q) ||
        option.integrationLabel.toLowerCase().includes(q),
    );
  }, [repositoryOptions, search]);

  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose}>
        <Pressable
          onPress={() => {}}
          className="mt-auto h-3/4 rounded-t-2xl border-gray-6 border-t bg-background"
          style={{
            paddingBottom: insets.bottom + 12,
            shadowColor: "#000",
            shadowOpacity: 0.15,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: -4 },
            elevation: 12,
          }}
        >
          {/* Drag handle */}
          <View className="items-center pt-2 pb-1">
            <View className="h-1 w-10 rounded-full bg-gray-6" />
          </View>

          <View className="px-4 pt-2 pb-3">
            <Text className="mb-3 font-semibold text-[16px] text-gray-12">
              Select repository
            </Text>
            <View className="flex-row items-center gap-2 rounded-md border border-gray-6 bg-gray-2 px-3 py-2">
              <MagnifyingGlass size={16} color={themeColors.gray[10]} />
              <TextInput
                className="flex-1 text-[14px] text-gray-12"
                placeholder="Search repositories"
                placeholderTextColor={themeColors.gray[9]}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
            </View>
          </View>

          {loading ? (
            <View className="items-center py-12">
              <ActivityIndicator size="small" color={themeColors.accent[9]} />
              <Text className="mt-3 text-[13px] text-gray-10">
                Loading repositories…
              </Text>
            </View>
          ) : (
            <ScrollView
              className="flex-1"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 12 }}
            >
              {filtered.length === 0 ? (
                <View className="items-center px-4 py-12">
                  <Text className="text-center text-[13px] text-gray-10">
                    {search
                      ? `No repositories match “${search}”`
                      : "No repositories available"}
                  </Text>
                </View>
              ) : (
                filtered.map((repo) => {
                  const isSelected =
                    repo.integrationId === selected?.integrationId &&
                    repo.repository === selected.repository;
                  return (
                    <Pressable
                      key={`${repo.integrationId}:${repo.repository}`}
                      onPress={() => {
                        onChange(repo);
                        onClose();
                      }}
                      className="flex-row items-center gap-2 px-4 py-3 active:bg-gray-2"
                    >
                      <View className="flex-1">
                        <Text
                          className="text-[14px] text-gray-12"
                          numberOfLines={1}
                        >
                          {repo.repository}
                        </Text>
                        <Text className="mt-0.5 text-[12px] text-gray-10">
                          {repo.integrationLabel}
                        </Text>
                      </View>
                      {isSelected ? (
                        <Check
                          size={16}
                          color={themeColors.accent[9]}
                          weight="bold"
                        />
                      ) : null}
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
