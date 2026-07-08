import { Text } from "@components/text";
import { CaretDown, GithubLogo } from "phosphor-react-native";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { RepositoryPickerInline } from "@/features/tasks/composer/RepositoryPickerInline";
import type {
  RepositoryOption,
  RepositorySelection,
} from "@/features/tasks/types";
import { findRepositoryOption } from "@/features/tasks/utils/repositorySelection";
import { useThemeColors } from "@/lib/theme";

interface RepositoryFieldProps {
  repositoryOptions: RepositoryOption[];
  selection: RepositorySelection;
  loading?: boolean;
  isRefreshing?: boolean;
  onChange: (option: RepositoryOption) => void;
  placeholder?: string;
}

/** Repeats the pill + inline-dropdown pattern from `AutomationForm`'s
 *  repository picker so loop forms get the same UX without depending on
 *  the automation-specific component. */
export function RepositoryField({
  repositoryOptions,
  selection,
  loading,
  isRefreshing,
  onChange,
  placeholder = "Select repository…",
}: RepositoryFieldProps) {
  const themeColors = useThemeColors();
  const [open, setOpen] = useState(false);

  const selected = useMemo(
    () => findRepositoryOption(repositoryOptions, selection),
    [repositoryOptions, selection],
  );

  const label = useMemo(() => {
    if (!selected) return placeholder;
    const sameRepoCount = repositoryOptions.filter(
      (option) => option.repository === selected.repository,
    ).length;
    return sameRepoCount > 1
      ? `${selected.repository} · ${selected.integrationLabel}`
      : selected.repository;
  }, [repositoryOptions, selected, placeholder]);

  return (
    <View>
      <Pressable
        onPress={() => setOpen((prev) => !prev)}
        accessibilityRole="button"
        accessibilityLabel="Select repository"
        className={`flex-row items-center gap-2 rounded-xl border px-3.5 py-3 active:bg-gray-3 ${
          open ? "border-accent-7 bg-accent-3" : "border-gray-5 bg-background"
        }`}
      >
        <GithubLogo
          size={16}
          color={selected ? themeColors.gray[12] : themeColors.gray[10]}
          weight={selected ? "fill" : "regular"}
        />
        <Text
          className={`flex-1 text-[15px] ${
            selected ? "text-gray-12" : "text-gray-9"
          }`}
          numberOfLines={1}
        >
          {label}
        </Text>
        <CaretDown
          size={12}
          color={themeColors.gray[10]}
          style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      <View className={open ? "mt-2" : ""}>
        <RepositoryPickerInline
          open={open}
          repositoryOptions={repositoryOptions}
          selected={selected}
          loading={loading}
          isRefreshing={isRefreshing}
          nested
          onChange={(option) => {
            onChange(option);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      </View>
    </View>
  );
}
