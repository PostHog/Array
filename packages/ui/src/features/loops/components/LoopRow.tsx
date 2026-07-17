import { CaretRightIcon, RepeatIcon } from "@phosphor-icons/react";
import type { LoopSchemas } from "@posthog/api-client/loops";
import { Badge } from "@posthog/ui/primitives/Badge";
import { Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { loopStatusColor, loopStatusLabel } from "../loopDisplay";

export function LoopRow({ loop }: { loop: LoopSchemas.Loop }) {
  return (
    <Link
      to="/code/loops/$loopId"
      params={{ loopId: loop.id }}
      className="flex items-center justify-between gap-3 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5 no-underline transition-colors duration-150 hover:border-(--gray-6) hover:bg-(--gray-2)"
    >
      <Flex align="center" gap="3" className="min-w-0">
        <RepeatIcon size={20} className="shrink-0 text-gray-11" />
        <Flex direction="column" className="min-w-0 gap-0.5">
          <Flex align="center" gap="2" className="min-w-0">
            <Text className="truncate font-medium text-[13px] text-gray-12">
              {loop.name}
            </Text>
            <Badge color={loopStatusColor(loop)}>{loopStatusLabel(loop)}</Badge>
            <Badge color="gray">{loop.visibility}</Badge>
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
