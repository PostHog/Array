import { CaretRightIcon, CompassIcon } from "@phosphor-icons/react";
import type { ScoutEmission } from "@posthog/api-client/posthog-client";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { track } from "@posthog/ui/shell/analytics";
import { Box, Flex, Text } from "@radix-ui/themes";
import { type ReactNode, useState } from "react";
import { SeverityBadge } from "./ScoutBadges";

export function ScoutEmissionCard({
  emission,
  skillName,
  footerEnd,
  defaultExpanded = false,
}: {
  emission: ScoutEmission;
  /** The emitting scout, attached to analytics events when known. */
  skillName?: string;
  /** Replaces the default pipeline note at the footer's right edge. */
  footerEnd?: ReactNode;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <Box className="min-w-0 overflow-hidden rounded-(--radius-2) border border-(--gray-6) bg-gray-1 p-3">
      <button
        type="button"
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          track(ANALYTICS_EVENTS.SCOUT_ACTION, {
            action_type: next ? "expand_emission" : "collapse_emission",
            surface: "scout_detail",
            skill_name: skillName,
            severity: emission.severity,
          });
        }}
        aria-expanded={expanded}
        className="flex w-full select-none items-center gap-2 text-left"
      >
        <CaretRightIcon
          size={11}
          className={`shrink-0 text-gray-9 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
        />
        <CompassIcon size={14} className="shrink-0 text-(--iris-9)" />
        <Text className="font-medium text-[13px] text-gray-10">Finding</Text>
        <SeverityBadge severity={emission.severity} />
        <Text className="text-[11px] text-gray-10">
          confidence {Math.round(emission.confidence * 100)}%
        </Text>
        <span className="flex-1" />
        <RelativeTimestamp timestamp={emission.emitted_at} />
      </button>
      <Box
        className={`mt-2 text-pretty break-words text-[13px] text-gray-11 leading-relaxed [&_code]:text-[11px] [&_p:last-child]:mb-0 [&_p]:mb-1 [&_pre]:text-[11px] ${
          expanded ? "" : "line-clamp-2"
        }`}
      >
        <MarkdownRenderer content={emission.description} />
      </Box>
      {expanded ? (
        <Flex
          align="center"
          gap="2"
          mt="2"
          pt="2"
          className="border-t border-t-(--gray-5) text-[11px] text-gray-10"
        >
          <Text className="font-mono text-[11px]">{emission.finding_id}</Text>
          <span className="flex-1" />
          {footerEnd ?? (
            <Text className="text-[11px] text-gray-9">
              Sent to the signals pipeline – report assignment isn&apos;t
              traceable here yet
            </Text>
          )}
        </Flex>
      ) : null}
    </Box>
  );
}
