import type { LoopSchemas } from "@posthog/api-client/loops";
import { Button, Switch } from "@posthog/quill";
import { toast } from "@posthog/ui/primitives/toast";
import { Flex, Text } from "@radix-ui/themes";
import { useState } from "react";
import { useUpdateLoop } from "../hooks/useLoopMutations";
import { emptyLoopScheduleTriggerConfig } from "../loopFormTypes";
import { ScheduleTriggerFields } from "./LoopTriggerEditor";

function scheduleTrigger(
  loop: LoopSchemas.Loop,
): LoopSchemas.LoopTrigger | null {
  return loop.triggers.find((trigger) => trigger.type === "schedule") ?? null;
}

export function updatedScheduleTriggers(
  loop: LoopSchemas.Loop,
  config: LoopSchemas.LoopScheduleTriggerConfig,
  enabled: boolean,
  scheduleId?: string,
): LoopSchemas.LoopTriggerWrite[] {
  const existingSchedule = scheduleId
    ? (loop.triggers.find((trigger) => trigger.id === scheduleId) ?? null)
    : scheduleTrigger(loop);
  const triggers = loop.triggers.map((trigger) => ({
    id: trigger.id,
    type: trigger.type,
    enabled: trigger.enabled,
    config: trigger.config,
  }));

  if (existingSchedule) {
    return triggers.map((trigger) =>
      trigger.id === existingSchedule.id
        ? { ...trigger, enabled, config }
        : trigger,
    );
  }

  return [...triggers, { type: "schedule", enabled, config }];
}

export function InlineLoopScheduleEditor({
  loop,
  schedule,
}: {
  loop: LoopSchemas.Loop;
  schedule?: LoopSchemas.LoopTrigger;
}) {
  const existingSchedule = schedule ?? scheduleTrigger(loop);
  const [config, setConfig] = useState<LoopSchemas.LoopScheduleTriggerConfig>(
    () =>
      existingSchedule
        ? (existingSchedule.config as LoopSchemas.LoopScheduleTriggerConfig)
        : emptyLoopScheduleTriggerConfig(),
  );
  const [enabled, setEnabled] = useState(existingSchedule?.enabled ?? true);
  const updateLoop = useUpdateLoop(loop.id);

  const save = async () => {
    try {
      await updateLoop.mutateAsync({
        triggers: updatedScheduleTriggers(
          loop,
          config,
          enabled,
          existingSchedule?.id,
        ),
      });
      toast.success(existingSchedule ? "Schedule updated" : "Schedule added");
    } catch (error) {
      toast.error("Failed to update schedule", {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <Flex direction="column" gap="3" className="w-full py-1">
      <Flex align="center" gap="3" wrap="wrap">
        <Text className="font-medium text-[12px] text-gray-11">Schedule</Text>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={updateLoop.isPending}
          aria-label={enabled ? "Disable schedule" : "Enable schedule"}
        />
      </Flex>

      <ScheduleTriggerFields
        config={config}
        disabled={updateLoop.isPending}
        onChange={setConfig}
      />

      <Flex justify="end">
        <Button
          variant="primary"
          size="sm"
          loading={updateLoop.isPending}
          onClick={() => void save()}
        >
          {existingSchedule ? "Save schedule" : "Add schedule"}
        </Button>
      </Flex>
    </Flex>
  );
}
