import * as Haptics from "expo-haptics";
import { Cards, ListBullets } from "phosphor-react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/theme";

type InboxViewMode = "list" | "tinder";

interface InboxViewToggleProps {
  mode: InboxViewMode;
  onModeChange: (mode: InboxViewMode) => void;
}

/**
 * Floating pill toggle at the bottom of the inbox screen. Two icons — list
 * view and tinder/card view — with the active one highlighted.
 */
export function InboxViewToggle({ mode, onModeChange }: InboxViewToggleProps) {
  const insets = useSafeAreaInsets();
  const themeColors = useThemeColors();

  const handlePress = (next: InboxViewMode) => {
    if (next === mode) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onModeChange(next);
  };

  return (
    <View
      className="absolute inset-x-0 items-center"
      style={{ bottom: insets.bottom + 16 }}
      pointerEvents="box-none"
    >
      <View className="elevation-4 flex-row items-center overflow-hidden rounded-full border border-gray-6 bg-card shadow-lg">
        <Pressable
          onPress={() => handlePress("list")}
          hitSlop={4}
          className={`items-center justify-center rounded-full px-5 py-3 ${mode === "list" ? "bg-accent-9" : "active:bg-gray-3"}`}
        >
          <ListBullets
            size={20}
            weight={mode === "list" ? "bold" : "regular"}
            color={
              mode === "list"
                ? themeColors.accent.contrast
                : themeColors.gray[11]
            }
          />
        </Pressable>
        <Pressable
          onPress={() => handlePress("tinder")}
          hitSlop={4}
          className={`items-center justify-center rounded-full px-5 py-3 ${mode === "tinder" ? "bg-accent-9" : "active:bg-gray-3"}`}
        >
          <Cards
            size={20}
            weight={mode === "tinder" ? "bold" : "regular"}
            color={
              mode === "tinder"
                ? themeColors.accent.contrast
                : themeColors.gray[11]
            }
          />
        </Pressable>
      </View>
    </View>
  );
}
