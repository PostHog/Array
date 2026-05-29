import { Spinner } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";

interface StatusNotificationViewProps {
  status: string;
  isComplete?: boolean;
}

export function StatusNotificationView({
  status,
  isComplete,
}: StatusNotificationViewProps) {
  if (status === "compacting") {
    if (isComplete) {
      return null;
    }
    return (
      <Box className="my-1 border-blue-6 border-l-2 py-1 pl-3 dark:border-blue-8">
        <Flex align="center" gap="2">
          <Spinner size={14} className="animate-spin text-blue-9" />
          <Text className="text-[13px] text-gray-11">
            Compacting conversation history...
          </Text>
        </Flex>
      </Box>
    );
  }

  // Generic status display for other statuses
  return (
    <Box className="my-1 border-gray-6 border-l-2 py-1 pl-3 dark:border-gray-8">
      <Flex align="center" gap="2">
        <Text className="text-[13px] text-gray-11">Status: {status}</Text>
      </Flex>
    </Box>
  );
}
