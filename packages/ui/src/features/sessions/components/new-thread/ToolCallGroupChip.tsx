import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import type { GroupSummary } from "@posthog/ui/features/sessions/components/new-thread/buildThreadGroups";
import { motion as motionConfig } from "@posthog/ui/features/sessions/components/new-thread/conversationThreadConfig";
import { ToolRow } from "@posthog/ui/features/sessions/components/session-update/ToolRow";
import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";

interface ToolCallGroupChipProps {
  summary: GroupSummary;
  expanded: boolean;
  turnComplete: boolean;
  onToggle: () => void;
  /** Rendered group items, shown inside the ToolRow's box when expanded. */
  children?: ReactNode;
}

/**
 * A tool-call group is just a ToolRow whose body is the turn's tool work: a
 * collapsible trigger (caret + summary + icon strip) and the same bordered
 * content box. While the turn runs it shows the live action; once complete it
 * shows a verb-led summary.
 */
export function ToolCallGroupChip({
  summary,
  expanded,
  turnComplete,
  onToggle,
  children,
}: ToolCallGroupChipProps) {
  const reduceMotion = useReducedMotion();
  const animate = motionConfig.enabled && !reduceMotion;
  const Caret = expanded ? CaretDownIcon : CaretRightIcon;
  const running = !turnComplete && summary.liveLabel != null;
  const label = running ? summary.liveLabel : summary.doneLabel;

  return (
    <motion.div
      initial={animate ? motionConfig.chip.initial : false}
      animate={animate ? motionConfig.chip.animate : undefined}
      transition={animate ? motionConfig.chip.transition : undefined}
      className="pl-3"
    >
      <ToolRow
        collapsible
        open={expanded}
        onOpenChange={onToggle}
        content={children}
        leading={
          <span className="shrink-0 pt-1">
            <Caret
              size={12}
              weight="bold"
              className="text-gray-10 transition-colors group-hover:text-gray-12"
            />
          </span>
        }
        trailing={
          !expanded && summary.icons.length > 0 ? (
            <span className="ml-1 flex shrink-0 items-center gap-1.5 text-gray-9">
              {summary.icons.map(({ Icon, key }) => (
                <Icon key={key} size={13} />
              ))}
            </span>
          ) : null
        }
      >
        <span className="truncate font-medium text-[13px] text-gray-11 transition-colors group-hover:text-gray-12">
          {label}
        </span>
      </ToolRow>
    </motion.div>
  );
}
