import { EnvelopeSimpleIcon } from "@phosphor-icons/react";
import {
  ANALYTICS_EVENTS,
  INBOX_GATED_DUE_TO_SCALE_FLAG,
} from "@posthog/shared";
import { useFeatureFlag } from "@posthog/ui/features/feature-flags/useFeatureFlag";
import { GatedDueToScalePane } from "@posthog/ui/features/inbox/components/InboxEmptyStates";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { track } from "@posthog/ui/shell/analytics";
import { Flex, Text } from "@radix-ui/themes";
import { useEffect, useMemo, useRef } from "react";
import { InboxSignalsTab } from "./InboxSignalsTab";

export function InboxView() {
  const isGatedDueToScale = useFeatureFlag(INBOX_GATED_DUE_TO_SCALE_FLAG);

  // Scale-gated users see GatedDueToScalePane instead of InboxSignalsTab (where
  // INBOX_VIEWED normally fires), and the inbox data isn't loaded while gated.
  // Fire the event here, once per gated visit, so these visits are still
  // measured — flagged so they're distinguishable from a genuinely empty inbox.
  const gatedViewedFiredRef = useRef(false);
  useEffect(() => {
    if (!isGatedDueToScale) {
      gatedViewedFiredRef.current = false;
      return;
    }
    if (gatedViewedFiredRef.current) return;
    gatedViewedFiredRef.current = true;
    track(ANALYTICS_EVENTS.INBOX_VIEWED, {
      report_count: 0,
      total_count: 0,
      ready_count: 0,
      has_active_filters: false,
      source_product_filter: [],
      status_filter_count: 0,
      is_empty: true,
      is_gated_due_to_scale: true,
      priority_p0_count: 0,
      priority_p1_count: 0,
      priority_p2_count: 0,
      priority_p3_count: 0,
      priority_p4_count: 0,
      priority_unknown_count: 0,
      actionability_immediately_actionable_count: 0,
      actionability_requires_human_input_count: 0,
      actionability_not_actionable_count: 0,
      actionability_unknown_count: 0,
    });
  }, [isGatedDueToScale]);

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
