import type { LoopSchemas } from "@posthog/api-client/loops";
import { Switch } from "@posthog/quill";
import { Flex, Text } from "@radix-ui/themes";
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
  config,
  enabled,
  disabled,
  onConfigChange,
  onEnabledChange,
}: {
  config: LoopSchemas.LoopScheduleTriggerConfig;
  enabled: boolean;
  disabled?: boolean;
  onConfigChange: (config: LoopSchemas.LoopScheduleTriggerConfig) => void;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <Flex direction="column" gap="3" className="w-full py-1">
      <Flex align="center" gap="3" wrap="wrap">
        <Text className="font-medium text-[12px] text-gray-11">Schedule</Text>
        <Switch
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={disabled}
          aria-label={enabled ? "Disable schedule" : "Enable schedule"}
        />
      </Flex>

      <ScheduleTriggerFields
        config={config}
        disabled={disabled}
        onChange={onConfigChange}
      />
    </Flex>
  );
}
