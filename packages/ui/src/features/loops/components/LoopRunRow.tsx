import type { LoopSchemas } from "@posthog/api-client/loops";
import { Badge } from "@posthog/ui/primitives/Badge";
import { Button } from "@posthog/ui/primitives/Button";
import { navigateToTaskDetail } from "@posthog/ui/router/navigationBridge";
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

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const sec = Math.round((Date.now() - then) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDuration(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return remMin ? `${hr}h ${remMin}m` : `${hr}h`;
}

function durationLabel(run: LoopSchemas.LoopRun): string {
  const start = new Date(run.created_at).getTime();
  if (Number.isNaN(start)) return "";
  if (run.completed_at) {
    const end = new Date(run.completed_at).getTime();
    if (!Number.isNaN(end)) return `ran ${formatDuration(end - start)}`;
  }
  if (run.status === "in_progress")
    return `running ${formatDuration(Date.now() - start)}`;
  if (run.status === "queued") return "queued";
  return "";
}

export function LoopRunRow({ run }: { run: LoopSchemas.LoopRun }) {
  const meta = [
    formatRelative(run.created_at),
    durationLabel(run),
    run.environment,
    run.loop_trigger_id ? "Triggered" : "Manual",
  ].filter(Boolean);

  return (
    <Flex
      align="center"
      justify="between"
      gap="3"
      className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-3 py-2.5"
    >
      <Flex direction="column" className="min-w-0 gap-1">
        <Flex align="center" gap="2" wrap="wrap">
          <Badge color={statusColor(run.status)}>{run.status}</Badge>
          <Text
            className="text-[12px] text-gray-11"
            title={new Date(run.created_at).toLocaleString()}
          >
            {meta.join(" · ")}
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
      <Button
        variant="soft"
        color="gray"
        size="1"
        className="shrink-0"
        onClick={() => navigateToTaskDetail(run.task_id)}
      >
        View run
      </Button>
    </Flex>
  );
}
