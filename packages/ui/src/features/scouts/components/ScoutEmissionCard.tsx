import { CaretRightIcon, CompassIcon } from "@phosphor-icons/react";
import type {
  LinkedSignalReport,
  ScoutEmission,
} from "@posthog/api-client/posthog-client";
import { ANALYTICS_EVENTS } from "@posthog/shared";
import { MarkdownRenderer } from "@posthog/ui/features/editor/components/MarkdownRenderer";
import { RelativeTimestamp } from "@posthog/ui/primitives/RelativeTimestamp";
import { track } from "@posthog/ui/shell/analytics";
import { Box, Flex, Text } from "@radix-ui/themes";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { SeverityBadge } from "./ScoutBadges";
import { ScoutLinkedReportChip } from "./ScoutLinkedReportChip";

export function ScoutEmissionCard({
  emission,
  skillName,
  actions,
  footerEnd,
  linkedReport,
  defaultExpanded = false,
  highlighted = false,
}: {
  emission: ScoutEmission;
  /** The emitting scout, attached to analytics events when known. */
  skillName?: string;
  /** Interactive controls shown after the finding id at the footer's left. */
  actions?: ReactNode;
  /** Replaces the default pipeline note at the footer's right edge. */
  footerEnd?: ReactNode;
  /**
   * The inbox report this finding's signal grouped into, when resolved by the
   * reverse lookup. Renders a chip linking to it; absent/undefined falls back
   * to the generic pipeline note.
   */
  linkedReport?: LinkedSignalReport | null;
  defaultExpanded?: boolean;
  /** True when a shared finding link targets this card – scrolls it into view. */
  highlighted?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const cardRef = useRef<HTMLDivElement>(null);
  // setExpanded too: when a shared link targets a different finding on an
  // already-mounted route, only the search param changes, so the useState
  // initializer's defaultExpanded never re-runs.
  useEffect(() => {
    if (highlighted) {
      setExpanded(true);
      cardRef.current?.scrollIntoView({ block: "center" });
    }
  }, [highlighted]);
  return (
    <Box
      ref={cardRef}
      className={`min-w-0 overflow-hidden rounded-(--radius-2) border bg-gray-1 p-3 ${
        highlighted ? "border-(--accent-8)" : "border-(--gray-6)"
      }`}
    >
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
          {linkedReport ? (
            <ScoutLinkedReportChip
              report={linkedReport}
              skillName={skillName}
            />
          ) : null}
          {actions}
          <span className="flex-1" />
          {footerEnd ??
            (linkedReport ? null : (
              <Text className="text-[11px] text-gray-9">
                Sent to the signals pipeline – report assignment isn&apos;t
                traceable here yet
              </Text>
            ))}
        </Flex>
      ) : null}
    </Box>
  );
}
