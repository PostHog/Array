import { Text } from "@components/text";
import {
  Lightning,
  PaperclipIcon,
  PencilSimple,
  Stack,
  Trash,
} from "phosphor-react-native";
import { type ReactNode, useState } from "react";
import { Pressable, View } from "react-native";
import { SheetContainer } from "@/components/SheetContainer";
import { useThemeColors } from "@/lib/theme";
import {
  type QueuedMessage,
  useMessageQueueStore,
} from "../stores/messageQueueStore";

interface QueuedMessagesDockProps {
  taskId: string;
  canSteer: boolean;
  onSteer: (message: QueuedMessage) => void;
  onReturnToComposer: (message: QueuedMessage) => void;
  onDiscard: (message: QueuedMessage) => void;
}

function previewText(message: QueuedMessage): string {
  if (message.content.trim().length > 0) return message.content;
  const count = message.attachments.length;
  return count === 1 ? "1 attachment" : `${count} attachments`;
}

export function QueuedMessagesDock({
  taskId,
  canSteer,
  onSteer,
  onReturnToComposer,
  onDiscard,
}: QueuedMessagesDockProps) {
  const themeColors = useThemeColors();
  const queued = useMessageQueueStore((s) => s.queuesByTaskId[taskId]);
  const [activeId, setActiveId] = useState<string | null>(null);

  if (!queued || queued.length === 0) return null;
  const active = queued.find((m) => m.id === activeId) ?? null;

  return (
    <>
      <View className="gap-1 px-3 pb-2">
        {queued.map((message) => (
          <Pressable
            key={message.id}
            onPress={() => setActiveId(message.id)}
            accessibilityRole="button"
            accessibilityLabel="Queued message actions"
            className="flex-row items-center gap-2 rounded-xl border border-gray-6 bg-card px-3 py-2 active:opacity-70"
          >
            <Stack size={14} color={themeColors.gray[10]} />
            <Text numberOfLines={1} className="flex-1 text-[13px] text-gray-11">
              {previewText(message)}
            </Text>
            {message.attachments.length > 0 ? (
              <PaperclipIcon size={13} color={themeColors.gray[9]} />
            ) : null}
            <Text className="text-[11px] text-gray-9">Queued</Text>
          </Pressable>
        ))}
      </View>

      <SheetContainer open={active !== null} onClose={() => setActiveId(null)}>
        {active ? (
          <>
            <View className="px-4 pt-2 pb-3">
              <Text numberOfLines={3} className="text-[14px] text-gray-12">
                {previewText(active)}
              </Text>
            </View>
            {canSteer ? (
              <ActionRow
                icon={
                  <Lightning
                    size={18}
                    color={themeColors.accent[11]}
                    weight="fill"
                  />
                }
                label="Steer now"
                description="Interrupt the current turn and send this now"
                onPress={() => {
                  onSteer(active);
                  setActiveId(null);
                }}
              />
            ) : null}
            <ActionRow
              icon={<PencilSimple size={18} color={themeColors.gray[11]} />}
              label="Edit in composer"
              description="Pull it back into the composer to revise"
              onPress={() => {
                onReturnToComposer(active);
                setActiveId(null);
              }}
            />
            <ActionRow
              icon={<Trash size={18} color={themeColors.status.error} />}
              label="Discard"
              destructive
              onPress={() => {
                onDiscard(active);
                setActiveId(null);
              }}
            />
          </>
        ) : null}
      </SheetContainer>
    </>
  );
}

function ActionRow({
  icon,
  label,
  description,
  destructive = false,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  description?: string;
  destructive?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-gray-2"
    >
      <View className="h-5 w-5 shrink-0 items-center justify-center">
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <Text
          className={`font-medium text-[15px] ${
            destructive ? "text-status-error" : "text-gray-12"
          }`}
        >
          {label}
        </Text>
        {description ? (
          <Text className="mt-0.5 text-[12px] text-gray-10">{description}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
