import { Text } from "@components/text";
import { FileText, WarningCircle, X } from "phosphor-react-native";
import { Image, Pressable, ScrollView, View } from "react-native";
import { useThemeColors } from "@/lib/theme";
import type { PendingAttachment } from "./types";

interface AttachmentsBarProps {
  attachments: PendingAttachment[];
  onRemove: (id: string) => void;
  /** Reason keyed by attachment id when it failed pick-time validation. */
  errors?: Record<string, string>;
}

function truncate(name: string, max = 18): string {
  if (name.length <= max) return name;
  const ext = name.lastIndexOf(".");
  if (ext > 0 && name.length - ext <= 6) {
    return `${name.slice(0, max - (name.length - ext) - 1)}…${name.slice(ext)}`;
  }
  return `${name.slice(0, max - 1)}…`;
}

export function AttachmentsBar({
  attachments,
  onRemove,
  errors,
}: AttachmentsBarProps) {
  const themeColors = useThemeColors();
  if (attachments.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="border-gray-5 border-b"
      contentContainerStyle={{
        paddingHorizontal: 8,
        paddingVertical: 8,
        gap: 8,
      }}
    >
      {attachments.map((att) => {
        const error = errors?.[att.id];
        return (
          <View
            key={att.id}
            className={`relative h-16 rounded-lg border bg-gray-2 ${
              error ? "border-status-error" : "border-gray-6"
            }`}
            style={{ minWidth: 64 }}
          >
            {att.kind === "image" ? (
              <Image
                source={{ uri: att.uri }}
                className="h-16 w-16 rounded-lg"
                resizeMode="cover"
              />
            ) : (
              <View className="h-16 w-32 flex-row items-center gap-2 px-2">
                <FileText
                  size={20}
                  color={themeColors.gray[11]}
                  weight="regular"
                />
                <Text
                  className="flex-1 text-[12px] text-gray-12"
                  numberOfLines={2}
                >
                  {truncate(att.fileName, 22)}
                </Text>
              </View>
            )}
            {error ? (
              <View
                accessibilityLabel={`Attachment can't be sent: ${error}`}
                className="absolute inset-0 items-center justify-center rounded-lg bg-black/40"
              >
                <WarningCircle
                  size={20}
                  color={themeColors.status.error}
                  weight="fill"
                />
              </View>
            ) : null}
            <Pressable
              onPress={() => onRemove(att.id)}
              hitSlop={8}
              accessibilityLabel={`Remove ${att.fileName}`}
              className="-top-1.5 -right-1.5 absolute h-5 w-5 items-center justify-center rounded-full bg-gray-12 active:opacity-80"
            >
              <X size={12} color={themeColors.background} weight="bold" />
            </Pressable>
          </View>
        );
      })}
    </ScrollView>
  );
}
