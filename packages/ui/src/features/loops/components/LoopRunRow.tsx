import type { LoopSchemas } from "@posthog/api-client/loops";
import { Badge } from "@posthog/ui/primitives/Badge";
import { Flex, Text } from "@radix-ui/themes";

function statusColor(
  status: LoopSchemas.LoopRunStatusEnum,
): "gray" | "green" | "red" | "blue" {
  switch (status) {
    case "completed":
      return "green";
    case "failed":
    case "cancelled":
      return "red";
    case "in_progress":
    case "queued":
      return "blue";
    default:
      return "gray";
  }
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

export function LoopRunRow({ run }: { run: LoopSchemas.LoopRun }) {
  return (
    <Flex
      align="center"
      justify="between"
      gap="3"
      className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-3 py-2.5"
    >
      <Flex direction="column" className="min-w-0 gap-0.5">
        <Flex align="center" gap="2">
          <Badge color={statusColor(run.status)}>{run.status}</Badge>
          <Text className="text-[12px] text-gray-11">
            {formatRelativeDate(run.created_at)}
          </Text>
        </Flex>
        {run.error_message ? (
          <Text className="truncate text-(--red-11) text-[11.5px]">
            {run.error_message}
          </Text>
        ) : run.branch ? (
          <Text className="truncate text-[11.5px] text-gray-10 [font-family:var(--font-mono)]">
            {run.branch}
          </Text>
        ) : null}
      </Flex>
      <Text className="shrink-0 text-[11px] text-gray-10 uppercase">
        {run.environment}
      </Text>
    </Flex>
  );
}
