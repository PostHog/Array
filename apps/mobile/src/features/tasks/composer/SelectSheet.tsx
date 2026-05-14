import { Text } from "@components/text";
import { Check } from "phosphor-react-native";
import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/theme";

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface SelectSheetProps<T extends string> {
  open: boolean;
  title: string;
  options: SelectOption<T>[];
  value: T;
  onChange: (value: T) => void;
  onClose: () => void;
}

export function SelectSheet<T extends string>({
  open,
  title,
  options,
  value,
  onChange,
  onClose,
}: SelectSheetProps<T>) {
  const themeColors = useThemeColors();
  const insets = useSafeAreaInsets();

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
          className="mt-auto rounded-t-2xl border-gray-6 border-t bg-background"
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

          <View className="px-4 pt-2 pb-2">
            <Text className="font-semibold text-[16px] text-gray-12">
              {title}
            </Text>
          </View>

          <ScrollView className="max-h-96">
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    if (option.disabled) return;
                    onChange(option.value);
                    onClose();
                  }}
                  disabled={option.disabled}
                  className={`flex-row items-center gap-3 px-4 py-3 ${
                    option.disabled ? "opacity-40" : "active:bg-gray-2"
                  }`}
                >
                  {option.icon ? (
                    <View className="h-5 w-5 shrink-0 items-center justify-center">
                      {option.icon}
                    </View>
                  ) : null}
                  <View className="min-w-0 flex-1">
                    <Text className="font-medium text-[15px] text-gray-12">
                      {option.label}
                    </Text>
                    {option.description ? (
                      <Text className="mt-0.5 text-[12px] text-gray-10">
                        {option.description}
                      </Text>
                    ) : null}
                  </View>
                  {selected ? (
                    <Check
                      size={16}
                      color={themeColors.accent[9]}
                      weight="bold"
                    />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
