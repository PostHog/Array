import { CaretRight } from "@phosphor-icons/react";
import { Flex, Text } from "@radix-ui/themes";
import type { Schemas } from "@renderer/api/generated";
import { formatRelativeTimeLong } from "@utils/time";
import {
  labelForCron,
  nextRunForPreset,
  presetForCron,
} from "../utils/schedulePresets";
import { ScheduledTaskStatusBadge } from "./ScheduledTaskStatusBadge";

interface ScheduledTaskRowProps {
  automation: Schemas.TaskAutomation;
  onClick: () => void;
}

function formatNextRun(automation: Schemas.TaskAutomation): string | null {
  if (automation.enabled === false) return null;
  const preset = presetForCron(automation.cron_expression);
  if (!preset) return null;
  const next = nextRunForPreset(preset.id);
  return next.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function ScheduledTaskRow({
  automation,
  onClick,
}: ScheduledTaskRowProps) {
  const nextRunText = formatNextRun(automation);

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full cursor-pointer rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-3 py-3 text-left transition-colors hover:bg-(--gray-3)"
    >
      <Flex align="center" gap="3" className="min-w-0">
        <Flex direction="column" gap="1" className="min-w-0 flex-1">
          <Flex align="center" gap="2" className="min-w-0">
            <Text
              size="2"
              weight="medium"
              className="truncate text-(--gray-12)"
            >
              {automation.name || "Untitled scheduled task"}
            </Text>
            <ScheduledTaskStatusBadge automation={automation} />
          </Flex>
          <Flex align="center" gap="3" wrap="wrap" className="min-w-0">
            <Text size="1" className="text-(--gray-11)">
              {labelForCron(automation.cron_expression)}
            </Text>
            {nextRunText && (
              <Text size="1" className="text-(--gray-10)">
                · Next {nextRunText}
              </Text>
            )}
            {automation.last_run_at && (
              <Text size="1" className="text-(--gray-10)">
                · Last ran {formatRelativeTimeLong(automation.last_run_at)}
              </Text>
            )}
          </Flex>
        </Flex>
        <CaretRight size={14} className="shrink-0 text-(--gray-9)" />
      </Flex>
    </button>
  );
}
