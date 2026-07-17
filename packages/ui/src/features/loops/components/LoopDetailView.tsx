import { ArrowLeftIcon, RepeatIcon } from "@phosphor-icons/react";
import type { LoopSchemas } from "@posthog/api-client/loops";
import { Switch } from "@posthog/quill";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { Badge } from "@posthog/ui/primitives/Badge";
import { Button } from "@posthog/ui/primitives/Button";
import { toast } from "@posthog/ui/primitives/toast";
import {
  navigateToEditLoop,
  navigateToLoops,
} from "@posthog/ui/router/navigationBridge";
import { AlertDialog, Flex, Text } from "@radix-ui/themes";
import { useState } from "react";
import { useLoop } from "../hooks/useLoop";
import {
  useDeleteLoop,
  useRunLoop,
  useUpdateLoop,
} from "../hooks/useLoopMutations";
import { RECENT_RUNS_LIMIT, useLoopRuns } from "../hooks/useLoopRuns";
import {
  describeTrigger,
  loopStatusColor,
  loopStatusLabel,
} from "../loopDisplay";
import { LoopLoadError } from "./LoopFallbacks";
import { LoopRunRow } from "./LoopRunRow";

export function LoopDetailView({ loopId }: { loopId: string }) {
  const { data: loop, isLoading, isError } = useLoop(loopId);
  const updateLoop = useUpdateLoop(loopId);
  const deleteLoop = useDeleteLoop();
  const runLoop = useRunLoop(loopId);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const runsQuery = useLoopRuns(loopId);
  const runs = runsQuery.data ?? [];

  useSetHeaderContent(
    <Flex align="center" gap="2" className="w-full min-w-0">
      <RepeatIcon size={12} className="shrink-0 text-gray-10" />
      <Text
        className="truncate whitespace-nowrap font-medium text-[13px]"
        title={loop?.name ?? "Loop"}
      >
        {loop?.name ?? "Loop"}
      </Text>
    </Flex>,
  );

  const handleToggleEnabled = (enabled: boolean) => {
    updateLoop.mutate(
      { enabled },
      {
        onError: (error) =>
          toast.error("Failed to update loop", {
            description: error.message,
          }),
      },
    );
  };

  const handleRunNow = () => {
    runLoop.mutate(undefined, {
      onSuccess: (result) => {
        if (result.created) {
          toast.success("Loop run started");
        } else {
          toast.error(`Run not started: ${result.reason}`);
        }
      },
      onError: (error) =>
        toast.error("Failed to start run", { description: error.message }),
    });
  };

  const handleDelete = () => {
    deleteLoop.mutate(loopId, {
      onSuccess: () => {
        toast.success("Loop deleted");
        navigateToLoops();
      },
      onError: (error) =>
        toast.error("Failed to delete loop", { description: error.message }),
    });
  };

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-5xl px-8 py-6">
        <div className="h-24 animate-pulse rounded-(--radius-2) border border-border bg-(--gray-2)" />
      </div>
    );
  }

  if (isError || !loop) {
    return <LoopLoadError />;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-6">
      <Flex direction="column" gap="5">
        <Flex direction="column" gap="3">
          <button
            type="button"
            onClick={navigateToLoops}
            className="flex w-fit items-center gap-1.5 border-none bg-transparent p-0 text-[12px] text-gray-11 no-underline hover:text-gray-12"
          >
            <ArrowLeftIcon size={13} />
            Loops
          </button>

          <Flex align="center" justify="between" gap="3" wrap="wrap">
            <Flex align="center" gap="2" wrap="wrap">
              <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
                {loop.name}
              </Text>
              <Badge color={loopStatusColor(loop)}>
                {loopStatusLabel(loop)}
              </Badge>
              <Badge color="gray">{loop.visibility}</Badge>
            </Flex>
            <Flex align="center" gap="2">
              <Switch
                checked={loop.enabled}
                disabled={updateLoop.isPending}
                aria-label={loop.enabled ? "Pause loop" : "Enable loop"}
                onCheckedChange={handleToggleEnabled}
              />
              <Button
                variant="soft"
                color="gray"
                size="1"
                loading={runLoop.isPending}
                disabled={runLoop.isPending}
                onClick={handleRunNow}
              >
                Run now
              </Button>
              <Button
                variant="soft"
                color="gray"
                size="1"
                onClick={() => navigateToEditLoop(loop.id)}
              >
                Edit
              </Button>
              <Button
                variant="soft"
                color="red"
                size="1"
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </Button>
            </Flex>
          </Flex>

          {loop.description.trim() ? (
            <Text className="max-w-3xl text-[12.5px] text-gray-11 leading-snug">
              {loop.description}
            </Text>
          ) : null}
        </Flex>

        <ConfigSummarySection loop={loop} />

        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <Text className="font-medium text-[13px] text-gray-12">
              Run history
            </Text>
            <Text className="text-[11px] text-gray-10">
              {RECENT_RUNS_LIMIT} most recent
            </Text>
          </Flex>
          {runsQuery.isLoading ? (
            <div className="h-16 animate-pulse rounded-(--radius-2) border border-border bg-(--gray-2)" />
          ) : runs.length === 0 ? (
            <Flex
              direction="column"
              align="center"
              gap="1"
              className="rounded-(--radius-2) border border-(--gray-5) border-dashed px-6 py-8 text-center"
            >
              <Text className="font-medium text-[12.5px] text-gray-12">
                No runs yet
              </Text>
              <Text className="max-w-sm text-[11.5px] text-gray-10 leading-snug">
                Runs show up here once this loop fires. Trigger one with Run
                now, or wait for its next trigger.
              </Text>
            </Flex>
          ) : (
            <Flex direction="column" gap="2">
              {runs.map((run) => (
                <LoopRunRow key={run.id} run={run} />
              ))}
            </Flex>
          )}
        </Flex>
      </Flex>

      <AlertDialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialog.Content maxWidth="420px" size="1">
          <AlertDialog.Title className="text-sm">Delete loop</AlertDialog.Title>
          <AlertDialog.Description className="text-[13px]">
            <Text color="gray" className="text-[13px]">
              Permanently delete{" "}
              <Text className="font-medium text-[13px]">{loop.name}</Text>? This
              stops every trigger and cannot be undone.
            </Text>
          </AlertDialog.Description>
          <Flex justify="end" gap="3" mt="3">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" size="1">
                Cancel
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="red"
                size="1"
                loading={deleteLoop.isPending}
                disabled={deleteLoop.isPending}
                onClick={handleDelete}
              >
                Delete
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </div>
  );
}

function ConfigSummarySection({ loop }: { loop: LoopSchemas.Loop }) {
  return (
    <Flex direction="column" gap="3">
      <Text className="font-medium text-[13px] text-gray-12">
        Configuration
      </Text>

      <Flex
        direction="column"
        gap="3"
        className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) p-3"
      >
        <SummaryRow label="Model">
          {[
            loop.runtime_adapter,
            loop.model,
            loop.reasoning_effort ? `${loop.reasoning_effort} reasoning` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </SummaryRow>

        <SummaryRow label="Repository">
          {loop.repositories.length > 0
            ? loop.repositories.map((repo) => repo.full_name).join(", ")
            : "None (connector-only loop)"}
        </SummaryRow>

        <SummaryRow label="Triggers">
          {loop.triggers.length === 0 ? (
            "No triggers configured"
          ) : (
            <Flex direction="column" gap="1">
              {loop.triggers.map((trigger) => (
                <Text key={trigger.id} className="text-[12.5px] text-gray-12">
                  {describeTrigger(trigger)}
                  {!trigger.enabled ? " (disabled)" : ""}
                </Text>
              ))}
            </Flex>
          )}
        </SummaryRow>

        <SummaryRow label="Instructions">
          <pre className="max-h-[200px] overflow-auto whitespace-pre-wrap text-[12px] text-gray-12 [font-family:var(--font-mono)]">
            {loop.instructions}
          </pre>
        </SummaryRow>
      </Flex>
    </Flex>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Flex direction="column" gap="1">
      <Text className="text-[11px] text-gray-10 uppercase tracking-wide">
        {label}
      </Text>
      <div className="text-[12.5px] text-gray-12">{children}</div>
    </Flex>
  );
}
