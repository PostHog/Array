import { ArrowLeftIcon, RepeatIcon } from "@phosphor-icons/react";
import type { LoopSchemas } from "@posthog/api-client/loops";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Switch,
  Textarea,
} from "@posthog/quill";
import { UserAvatar } from "@posthog/ui/features/auth/UserAvatar";
import { useOrgMembers } from "@posthog/ui/features/canvas/hooks/useOrgMembers";
import { userDisplayName } from "@posthog/ui/features/canvas/utils/userDisplay";
import { useSetHeaderContent } from "@posthog/ui/hooks/useSetHeaderContent";
import { TimezoneTimestamp } from "@posthog/ui/primitives/TimezoneTimestamp";
import { systemTimezone } from "@posthog/ui/primitives/timezone";
import { toast } from "@posthog/ui/primitives/toast";
import {
  navigateToEditLoop,
  navigateToLoops,
} from "@posthog/ui/router/navigationBridge";
import { Flex, Text } from "@radix-ui/themes";
import { useRef, useState } from "react";
import { useLoop } from "../hooks/useLoop";
import { useLoopDisplayModel } from "../hooks/useLoopDisplayModel";
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
  nextScheduleRun,
  summarizeNotificationDestinations,
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
      <div className="mx-auto w-full max-w-5xl px-8 py-8">
        <div className="h-24 animate-pulse rounded-(--radius-2) border border-border bg-(--gray-2)" />
      </div>
    );
  }

  if (isError || !loop) {
    return <LoopLoadError />;
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto">
      <Flex
        direction="column"
        gap="5"
        className="mx-auto w-full max-w-5xl px-8 py-8"
      >
        <Flex direction="column" gap="3">
          <Button
            variant="link-muted"
            size="sm"
            onClick={navigateToLoops}
            className="w-fit px-0"
          >
            <ArrowLeftIcon size={15} />
            Loops
          </Button>

          <Flex align="center" justify="between" gap="3" wrap="wrap">
            <Flex align="center" gap="2" wrap="wrap">
              <Text className="font-bold text-[22px] text-gray-12 leading-tight tracking-tight">
                {loop.name}
              </Text>
              <Badge variant={loopStatusBadgeVariant(loop)}>
                {loopStatusLabel(loop)}
              </Badge>
              <Badge>{loop.visibility}</Badge>
            </Flex>
            <Flex align="center" gap="2">
              <Switch
                checked={loop.enabled}
                disabled={updateLoop.isPending}
                aria-label={loop.enabled ? "Pause loop" : "Enable loop"}
                onCheckedChange={handleToggleEnabled}
              />
              <Button
                variant="outline"
                size="sm"
                loading={runLoop.isPending}
                disabled={runLoop.isPending}
                onClick={handleRunNow}
              >
                Run now
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigateToEditLoop(loop.id)}
              >
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
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

        <InstructionsSection loop={loop} />

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
                <LoopRunRow
                  key={run.id}
                  run={run}
                  onStopped={() => void runsQuery.refetch()}
                />
              ))}
            </Flex>
          )}
        </Flex>
      </Flex>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete loop</AlertDialogTitle>
            <AlertDialogDescription>
              <Text color="gray" className="text-[13px]">
                Permanently delete{" "}
                <Text className="font-medium text-[13px]">{loop.name}</Text>?
                This stops every trigger and cannot be undone.
              </Text>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose
              render={
                <Button variant="outline" size="sm">
                  Cancel
                </Button>
              }
            />
            <Button
              variant="destructive"
              size="sm"
              loading={deleteLoop.isPending}
              disabled={deleteLoop.isPending}
              onClick={handleDelete}
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function loopStatusBadgeVariant(
  loop: LoopSchemas.Loop,
): "default" | "destructive" | "success" {
  const color = loopStatusColor(loop);
  if (color === "green") return "success";
  if (color === "red") return "destructive";
  return "default";
}

function ConfigSummarySection({ loop }: { loop: LoopSchemas.Loop }) {
  const displayModel = useLoopDisplayModel(loop.runtime_adapter, loop.model);
  const {
    members,
    isLoading: membersLoading,
    isError: membersError,
    isComplete: membersComplete,
  } = useOrgMembers({ enabled: loop.visibility === "team" });
  const creator = members.find((member) => member.id === loop.created_by_id);
  let creatorContent: React.ReactNode = null;
  if (loop.visibility === "team" && membersError) {
    creatorContent = "Creator unavailable";
  } else if (loop.visibility === "team" && membersLoading) {
    creatorContent = "Loading…";
  } else if (loop.visibility === "team" && creator) {
    creatorContent = (
      <Flex align="center" gap="2">
        <UserAvatar user={creator} size="xs" />
        {userDisplayName(creator)}
      </Flex>
    );
  } else if (loop.visibility === "team" && membersComplete) {
    creatorContent = "Former organization member";
  } else if (loop.visibility === "team") {
    creatorContent = "Creator unavailable";
  }
  const notificationDestinations = summarizeNotificationDestinations(
    loop.notifications,
  );

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
            displayModel,
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

        {loop.visibility === "team" ? (
          <SummaryRow label="Created by">{creatorContent}</SummaryRow>
        ) : null}

        <SummaryRow label="Triggers">
          {loop.triggers.length === 0 ? (
            "No triggers configured"
          ) : (
            <Flex direction="column" gap="1">
              {loop.triggers.map((trigger) => (
                <Text key={trigger.id} className="text-[12.5px] text-gray-12">
                  <TriggerDescription trigger={trigger} />
                  {!trigger.enabled ? " (disabled)" : ""}
                </Text>
              ))}
            </Flex>
          )}
        </SummaryRow>

        {notificationDestinations.length > 0 ? (
          <SummaryRow label="Notifications">
            {notificationDestinations.join(", ")}
          </SummaryRow>
        ) : null}
      </Flex>
    </Flex>
  );
}

function InstructionsSection({ loop }: { loop: LoopSchemas.Loop }) {
  const updateLoop = useUpdateLoop(loop.id);
  const [draft, setDraft] = useState<string | null>(null);
  // Escape reverts and blurs; skip the resulting onBlur save.
  const skipCommit = useRef(false);

  const commit = (value: string) => {
    if (skipCommit.current) {
      skipCommit.current = false;
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      setDraft(null);
      return;
    }
    if (updateLoop.isPending) return;
    if (trimmed === loop.instructions.trim()) {
      setDraft(null);
      return;
    }
    updateLoop.mutate(
      { instructions: trimmed },
      {
        onSuccess: () => {
          setDraft(null);
          toast.success("Instructions updated");
        },
        onError: (error) => {
          setDraft(null);
          toast.error("Failed to update instructions", {
            description: error.message,
          });
        },
      },
    );
  };

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="2">
        <Text className="font-medium text-[13px] text-gray-12">
          Instructions
        </Text>
        {updateLoop.isPending ? (
          <Text className="text-[11px] text-gray-10">Saving…</Text>
        ) : null}
      </Flex>
      <Textarea
        value={draft ?? loop.instructions}
        disabled={updateLoop.isPending}
        aria-label="Loop instructions"
        className="max-h-[400px] min-h-[200px] bg-(--color-panel-solid) text-[12.5px] leading-relaxed"
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            skipCommit.current = true;
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
    </Flex>
  );
}

function TriggerDescription({ trigger }: { trigger: LoopSchemas.LoopTrigger }) {
  const description = describeTrigger(trigger);
  if (trigger.type !== "schedule") return description;

  const config = trigger.config as LoopSchemas.LoopScheduleTriggerConfig;
  const nextRun = nextScheduleRun(config);
  if (!nextRun) return description;
  const nextRunSeparator = " · Next run ";
  const [scheduleDescription, nextRunDescription] =
    description.split(nextRunSeparator);
  const timezone =
    config.timezone ?? (config.run_at ? systemTimezone() : "UTC");

  return (
    <>
      {scheduleDescription}
      {nextRunSeparator}
      <TimezoneTimestamp
        timestamp={nextRun}
        timezone={timezone}
        label={nextRunDescription}
      />
    </>
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
