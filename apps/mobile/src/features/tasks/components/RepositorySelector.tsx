import { Text } from "@components/text";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import type { RepositoryOption, RepositorySelection } from "../types";

interface RepositorySelectorProps {
  options: RepositoryOption[];
  value: RepositorySelection;
  onChange: (selection: RepositorySelection) => void;
}

export function RepositorySelector({
  options,
  value,
  onChange,
}: RepositorySelectorProps) {
  const themeColors = useThemeColors();
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) {
      return options;
    }

    return options.filter(
      (option) =>
        option.repository.toLowerCase().includes(query) ||
        option.integrationLabel.toLowerCase().includes(query),
    );
  }, [options, search]);

  return (
    <>
      <TextInput
        className="mb-2 rounded-xl border border-gray-5 bg-background px-3.5 py-3 text-[15px] text-gray-12"
        placeholder="Search repositories"
        placeholderTextColor={themeColors.gray[9]}
        value={search}
        onChangeText={setSearch}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="while-editing"
      />
      <ScrollView
        className="max-h-56 rounded-xl border border-gray-5 bg-background"
        keyboardShouldPersistTaps="handled"
        nestedScrollEnabled
      >
        {filteredOptions.length === 0 ? (
          <View className="px-3 py-4">
            <Text className="text-center text-gray-9 text-sm">
              {search
                ? `No repositories match "${search}"`
                : "No repositories available"}
            </Text>
          </View>
        ) : (
          filteredOptions.map((option) => {
            const isSelected =
              value.integrationId === option.integrationId &&
              value.repository === option.repository;

            return (
              <Pressable
                key={`${option.integrationId}:${option.repository}`}
                onPress={() =>
                  onChange({
                    integrationId: option.integrationId,
                    repository: option.repository,
                  })
                }
                className={`border-gray-5 border-b px-3.5 py-3 ${
                  isSelected ? "bg-accent-3" : ""
                }`}
              >
                <Text
                  className={`text-sm ${
                    isSelected ? "text-accent-11" : "text-gray-11"
                  }`}
                >
                  {option.repository}
                </Text>
                <Text className="mt-0.5 text-gray-9 text-xs">
                  {option.integrationLabel}
                </Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </>
  );
}
