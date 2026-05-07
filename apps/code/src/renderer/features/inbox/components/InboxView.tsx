import { useFeatureFlag } from "@hooks/useFeatureFlag";
import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import { INBOX_GATED_DUE_TO_SCALE_FLAG } from "@shared/constants";
import { useMemo } from "react";
import { GatedDueToScalePane } from "./InboxEmptyStates";
import { InboxSignalsTab } from "./InboxSignalsTab";

export function InboxView() {
  const isGatedDueToScale = useFeatureFlag(INBOX_GATED_DUE_TO_SCALE_FLAG);

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
      {isGatedDueToScale ? <GatedDueToScalePane /> : <InboxSignalsTab />}
    </div>
  );
}
