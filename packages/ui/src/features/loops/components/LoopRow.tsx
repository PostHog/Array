import { CaretRightIcon, RepeatIcon } from "@phosphor-icons/react";
import type { LoopSchemas } from "@posthog/api-client/loops";
import { Badge } from "@posthog/ui/primitives/Badge";
import { Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";

function statusColor(loop: LoopSchemas.Loop): "gray" | "green" | "red" {
  if (!loop.enabled) return "gray";
  if (loop.last_run_status === "failed") return "red";
  return "green";
}

function statusLabel(loop: LoopSchemas.Loop): string {
  if (!loop.enabled) return "Paused";
  if (loop.last_run_status === "failed") return "Failing";
  return "Active";
}

export function LoopRow({ loop }: { loop: LoopSchemas.Loop }) {
  return (
    <Link
      to="/code/loops/$loopId"
      params={{ loopId: loop.id }}
      className="flex items-center justify-between gap-3 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5 no-underline transition-colors duration-150 hover:border-(--gray-6) hover:bg-(--gray-2)"
    >
      <Flex align="center" gap="3" className="min-w-0">
        <RepeatIcon size={20} className="shrink-0 text-gray-11" />
        <Flex direction="column" gap="0.5" className="min-w-0">
          <Flex align="center" gap="2" className="min-w-0">
            <Text className="truncate font-medium text-[13px] text-gray-12">
              {loop.name}
            </Text>
            <Badge color={statusColor(loop)}>{statusLabel(loop)}</Badge>
          </Flex>
          <Text className="truncate text-[12px] text-gray-11 leading-snug">
            {loop.description.trim()
              ? loop.description
              : loop.triggers.length === 0
                ? "No triggers configured"
                : `${loop.triggers.length} trigger${loop.triggers.length === 1 ? "" : "s"}`}
          </Text>
        </Flex>
      </Flex>
      <Flex align="center" gap="3" className="shrink-0">
        {loop.consecutive_failures > 0 ? (
          <Text className="text-(--red-11) text-[11px]">
            {loop.consecutive_failures} failed in a row
          </Text>
        ) : null}
        <CaretRightIcon size={14} className="shrink-0 text-gray-10" />
      </Flex>
    </Link>
  );
}
