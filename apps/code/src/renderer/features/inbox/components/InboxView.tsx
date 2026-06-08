import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import { useMemo } from "react";
import { InboxSignalsTab } from "./InboxSignalsTab";

export function InboxView() {
  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="w-full min-w-0">
        <EnvelopeSimpleIcon size={12} className="shrink-0 text-gray-10" />
        <Text
          className="truncate whitespace-nowrap font-medium text-[13px]"
          title="Inbox"
        >
          Inbox
        </Text>
      </Flex>
    ),
    [],
  );

  useSetHeaderContent(headerContent);

  return (
    <div className="h-full">
      <InboxSignalsTab />
    </div>
  );
}
