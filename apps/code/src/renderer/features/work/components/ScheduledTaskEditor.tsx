import { useSetHeaderContent } from "@hooks/useSetHeaderContent";
import {
  ArrowLeft,
  ArrowSquareOut,
  ClockCounterClockwise,
  FloppyDisk,
  Play,
  Trash,
} from "@phosphor-icons/react";
import {
  Box,
  Button,
  Callout,
  Flex,
  ScrollArea,
  Switch,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import type { Schemas } from "@renderer/api/generated";
import { useNavigationStore } from "@stores/navigationStore";
import { formatRelativeTimeLong } from "@utils/time";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useOpenLastRun } from "../hooks/useOpenLastRun";
import {
  useCreateScheduledTask,
  useDeleteScheduledTask,
  useRunScheduledTaskNow,
  useScheduledTasks,
  useUpdateScheduledTask,
} from "../hooks/useScheduledTasks";
import { useWorkStore } from "../stores/workStore";
import { describeCron, parseSchedule } from "../utils/parseSchedule";
import { decodePrompt, encodePrompt } from "../utils/sourcesPrompt";
import { detectTimezone } from "../utils/timezone";
import { ScheduledTaskStatusBadge } from "./ScheduledTaskStatusBadge";
import { ScheduleField } from "./ScheduleField";
import { SourcesPicker } from "./SourcesPicker";

interface ScheduledTaskEditorProps {
  editingId: string | null;
}

interface Draft {
  name: string;
  promptBody: string;
  sources: string[];
  scheduleText: string;
  enabled: boolean;
}

function toDraft(automation: Schemas.TaskAutomation | null): Draft {
  if (!automation) {
    return {
      name: "",
      promptBody: "",
      sources: [],
      scheduleText: "Daily at 9am",
      enabled: true,
    };
  }
  const { sources, body } = decodePrompt(automation.prompt);
  return {
    name: automation.name,
    promptBody: body,
    sources,
    scheduleText: describeCron(automation.cron_expression),
    enabled: automation.enabled ?? true,
  };
}

export function ScheduledTaskEditor({ editingId }: ScheduledTaskEditorProps) {
  const showList = useNavigationStore((s) => s.navigateToWorkScheduledList);
  const consumePendingCreateDraft = useWorkStore(
    (s) => s.consumePendingCreateDraft,
  );
  const { data: automations } = useScheduledTasks();

  const existing = useMemo(
    () => automations?.find((a) => a.id === editingId) ?? null,
    [automations, editingId],
  );

  const [draft, setDraft] = useState<Draft>(() => {
    const base = toDraft(existing);
    if (!existing) {
      const seeded = consumePendingCreateDraft();
      if (seeded) {
        return {
          ...base,
          name: seeded.name ?? base.name,
          promptBody: seeded.prompt ?? base.promptBody,
        };
      }
    }
    return base;
  });

  // Sync the draft when the editor is pointed at a different existing automation.
  useEffect(() => {
    if (existing) setDraft(toDraft(existing));
    // The id is what should trigger a reset — other field changes from polling
    // shouldn't clobber user edits.
  }, [existing?.id, existing]);

  const createScheduledTask = useCreateScheduledTask();
  const updateScheduledTask = useUpdateScheduledTask();
  const deleteScheduledTask = useDeleteScheduledTask();
  const runScheduledTaskNow = useRunScheduledTaskNow();
  const { openLastRun, isOpening } = useOpenLastRun();

  const isEditing = editingId !== null && existing !== null;
  const isSaving =
    createScheduledTask.isPending || updateScheduledTask.isPending;

  const nameTrimmed = draft.name.trim();
  const promptTrimmed = draft.promptBody.trim();
  const parsedSchedule = parseSchedule(draft.scheduleText);
  const missingFields = !nameTrimmed || !promptTrimmed || !parsedSchedule;
  const canSave = !missingFields && !isSaving;

  const headerContent = useMemo(
    () => (
      <Flex align="center" gap="2" className="min-w-0">
        <ClockCounterClockwise
          size={12}
          className="shrink-0 text-(--gray-10)"
        />
        <Text
          size="1"
          weight="medium"
          className="truncate font-mono text-[12px]"
        >
          {isEditing ? existing.name || "Scheduled task" : "New scheduled task"}
        </Text>
      </Flex>
    ),
    [isEditing, existing],
  );
  useSetHeaderContent(headerContent);

  const handleSave = async () => {
    if (!canSave || !parsedSchedule) return;
    const promptToSend = encodePrompt(promptTrimmed, draft.sources);

    try {
      if (isEditing) {
        await updateScheduledTask.mutateAsync({
          id: existing.id,
          updates: {
            name: nameTrimmed,
            prompt: promptToSend,
            cron_expression: parsedSchedule.cron,
            enabled: draft.enabled,
          },
        });
        toast.success("Scheduled task updated");
      } else {
        await createScheduledTask.mutateAsync({
          name: nameTrimmed,
          prompt: promptToSend,
          cron_expression: parsedSchedule.cron,
          // Work-mode tasks aren't repo-scoped, but the backend currently
          // requires a non-blank `repository`. Send a sentinel until the
          // backend makes the field nullable; the runtime ignores it for
          // PostHog-data skills.
          repository: "posthog-work",
          timezone: detectTimezone(),
          enabled: draft.enabled,
        });
        toast.success("Scheduled task created");
      }
      showList();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to save scheduled task",
      );
    }
  };

  const handleDelete = async () => {
    if (!isEditing) return;
    if (
      !window.confirm(
        `Delete "${existing.name || "this scheduled task"}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await deleteScheduledTask.mutateAsync(existing.id);
      toast.success("Scheduled task deleted");
      showList();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to delete scheduled task",
      );
    }
  };

  const handleRunNow = async () => {
    if (!isEditing) return;
    try {
      await runScheduledTaskNow.mutateAsync(existing.id);
      toast.success("Running now — opening the task to follow along");
      // After the run is triggered the automation row gets new last_task_id /
      // last_task_run_id values on the next refetch. We don't deep-link
      // immediately because the task may take a moment to appear in cache.
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to run scheduled task",
      );
    }
  };

  return (
    <Flex direction="column" height="100%" className="overflow-hidden">
      <Flex
        align="center"
        justify="between"
        px="4"
        py="3"
        className="shrink-0 border-(--gray-6) border-b"
      >
        <Flex align="center" gap="2">
          <Button size="1" variant="ghost" onClick={showList}>
            <ArrowLeft size={14} />
            Back
          </Button>
          <Text size="3" weight="medium" className="text-(--gray-12)">
            {isEditing ? "Edit scheduled task" : "New scheduled task"}
          </Text>
        </Flex>
        <Flex align="center" gap="2">
          {isEditing && (
            <>
              <Button
                size="2"
                variant="soft"
                color="gray"
                onClick={handleRunNow}
                loading={runScheduledTaskNow.isPending}
              >
                <Play size={14} />
                Run now
              </Button>
              <Button
                size="2"
                variant="soft"
                color="red"
                onClick={handleDelete}
                loading={deleteScheduledTask.isPending}
              >
                <Trash size={14} />
                Delete
              </Button>
            </>
          )}
          <Button
            size="2"
            onClick={handleSave}
            disabled={!canSave}
            loading={isSaving}
          >
            <FloppyDisk size={14} />
            Save
          </Button>
        </Flex>
      </Flex>

      <ScrollArea type="auto" className="min-h-0 flex-1">
        <Box px="4" py="4" className="mx-auto max-w-2xl">
          <Flex direction="column" gap="4">
            <Flex direction="column" gap="2">
              <Text size="1" weight="medium" className="text-(--gray-11)">
                Name
              </Text>
              <TextField.Root
                size="2"
                placeholder="e.g. Audit feature flags weekly"
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </Flex>

            <Flex direction="column" gap="2">
              <Text size="1" weight="medium" className="text-(--gray-11)">
                What should it do?
              </Text>
              <TextArea
                size="2"
                placeholder="Describe what you want done in plain English."
                value={draft.promptBody}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, promptBody: e.target.value }))
                }
                rows={6}
                className="resize-y"
              />
              <Text size="1" className="text-(--gray-10)">
                The agent picks the right skill from your request when the task
                runs — no need to specify one.
              </Text>
            </Flex>

            <ScheduleField
              value={draft.scheduleText}
              onChange={(scheduleText) =>
                setDraft((d) => ({ ...d, scheduleText }))
              }
            />

            <SourcesPicker
              value={draft.sources}
              onChange={(sources) => setDraft((d) => ({ ...d, sources }))}
            />

            {isEditing && (
              <Flex
                align="center"
                justify="between"
                className="rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-3 py-2"
              >
                <Flex direction="column" gap="1">
                  <Text size="2" weight="medium" className="text-(--gray-12)">
                    Enabled
                  </Text>
                  <Text size="1" className="text-(--gray-10)">
                    When off, the task won't run on its schedule.
                  </Text>
                </Flex>
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(enabled) =>
                    setDraft((d) => ({ ...d, enabled }))
                  }
                />
              </Flex>
            )}

            {isEditing && existing.last_run_at && (
              <Flex
                direction="column"
                gap="2"
                className="rounded-(--radius-2) border border-(--gray-5) bg-(--gray-2) px-3 py-3"
              >
                <Flex align="center" justify="between" gap="3">
                  <Flex direction="column" gap="1" className="min-w-0">
                    <Text size="1" weight="medium" className="text-(--gray-11)">
                      Last run
                    </Text>
                    <Flex align="center" gap="2">
                      <ScheduledTaskStatusBadge automation={existing} />
                      <Text size="2" className="truncate text-(--gray-12)">
                        {formatRelativeTimeLong(existing.last_run_at)}
                      </Text>
                    </Flex>
                  </Flex>
                  {existing.last_task_id && (
                    <Button
                      size="2"
                      variant="soft"
                      onClick={() =>
                        openLastRun(
                          existing.last_task_id ?? "",
                          existing.last_task_run_id,
                        )
                      }
                      loading={isOpening}
                    >
                      <ArrowSquareOut size={14} />
                      Open task
                    </Button>
                  )}
                </Flex>
                {existing.last_error && (
                  <Callout.Root size="1" color="red" variant="soft">
                    <Callout.Text>{existing.last_error}</Callout.Text>
                  </Callout.Root>
                )}
              </Flex>
            )}

            {missingFields && (
              <Text size="1" className="text-(--gray-10)">
                Add a name, a prompt, and a schedule to save.
              </Text>
            )}
          </Flex>
        </Box>
      </ScrollArea>
    </Flex>
  );
}
