import { Text } from "@components/text";
import { Camera, FileText, Image as ImageIcon } from "phosphor-react-native";
import { Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/lib/theme";

interface AttachmentSheetProps {
  open: boolean;
  onClose: () => void;
  onPickPhoto: () => void;
  onPickCamera: () => void;
  onPickDocument: () => void;
}

interface RowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  onPress: () => void;
}

function Row({ icon, label, description, onPress }: RowProps) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-gray-2"
    >
      <View className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-3">
        {icon}
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-medium text-[15px] text-gray-12">{label}</Text>
        <Text className="mt-0.5 text-[12px] text-gray-10">{description}</Text>
      </View>
    </Pressable>
  );
}

export function AttachmentSheet({
  open,
  onClose,
  onPickPhoto,
  onPickCamera,
  onPickDocument,
}: AttachmentSheetProps) {
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
          <View className="items-center pt-2 pb-1">
            <View className="h-1 w-10 rounded-full bg-gray-6" />
          </View>

          <View className="px-4 pt-2 pb-2">
            <Text className="font-semibold text-[16px] text-gray-12">
              Add attachment
            </Text>
          </View>

          <Row
            icon={
              <ImageIcon size={18} color={themeColors.gray[12]} weight="bold" />
            }
            label="Photo library"
            description="Pick a photo to share with the agent"
            onPress={() => {
              onClose();
              onPickPhoto();
            }}
          />
          <Row
            icon={
              <Camera size={18} color={themeColors.gray[12]} weight="bold" />
            }
            label="Take photo"
            description="Capture a new photo from the camera"
            onPress={() => {
              onClose();
              onPickCamera();
            }}
          />
          <Row
            icon={
              <FileText size={18} color={themeColors.gray[12]} weight="bold" />
            }
            label="File"
            description="Attach a text or code file from your device"
            onPress={() => {
              onClose();
              onPickDocument();
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}
