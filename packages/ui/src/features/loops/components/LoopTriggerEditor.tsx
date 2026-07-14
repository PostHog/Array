import {
  CalendarBlank,
  GithubLogo,
  Globe,
  Plus,
  Trash,
} from "@phosphor-icons/react";
import type { LoopSchemas } from "@posthog/api-client/loops";
import { Switch } from "@posthog/quill";
import { CopyButton } from "@posthog/ui/features/agent-applications/components/CopyButton";
import { SettingsOptionSelect } from "@posthog/ui/features/settings/SettingsOptionSelect";
import { Button } from "@posthog/ui/primitives/Button";
import {
  Box,
  Checkbox,
  Flex,
  IconButton,
  Text,
  TextField,
} from "@radix-ui/themes";
import { useState } from "react";
import {
  emptyLoopApiTriggerConfig,
  emptyLoopGithubTriggerConfig,
  emptyLoopScheduleTriggerConfig,
  isTriggerDraftValid,
  type LoopTriggerDraft,
  nextDraftTriggerKey,
} from "../loopFormTypes";
import { LoopRepositoryPicker } from "./LoopRepositoryPicker";

const TRIGGER_TYPE_OPTIONS: {
  value: LoopSchemas.LoopTriggerTypeEnum;
  label: string;
}[] = [
  { value: "schedule", label: "Schedule" },
  { value: "github", label: "GitHub event" },
  { value: "api", label: "API" },
];

const GITHUB_EVENT_OPTIONS: {
  value: LoopSchemas.LoopGithubTriggerEventEnum;
  label: string;
}[] = [
  { value: "push", label: "Push" },
  { value: "pull_request", label: "Pull request" },
  { value: "issues", label: "Issues" },
  { value: "issue_comment", label: "Issue comment" },
];

function triggerTypeIcon(type: LoopSchemas.LoopTriggerTypeEnum) {
  switch (type) {
    case "schedule":
      return <CalendarBlank size={14} className="text-gray-10" />;
    case "github":
      return <GithubLogo size={14} className="text-gray-10" />;
    case "api":
      return <Globe size={14} className="text-gray-10" />;
  }
}

function configForType(
  type: LoopSchemas.LoopTriggerTypeEnum,
): LoopSchemas.LoopTriggerConfig {
  switch (type) {
    case "schedule":
      return emptyLoopScheduleTriggerConfig();
    case "github":
      return emptyLoopGithubTriggerConfig();
    case "api":
      return emptyLoopApiTriggerConfig();
  }
}

interface LoopTriggerEditorProps {
  triggers: LoopTriggerDraft[];
  onChange: (triggers: LoopTriggerDraft[]) => void;
  /** Rendered in the API trigger card. Absent for a not-yet-created loop. */
  triggerEndpointPath: string | null;
  disabled?: boolean;
}

export function LoopTriggerEditor({
  triggers,
  onChange,
  triggerEndpointPath,
  disabled,
}: LoopTriggerEditorProps) {
  const updateTrigger = (key: string, patch: Partial<LoopTriggerDraft>) => {
    onChange(
      triggers.map((trigger) =>
        trigger.key === key ? { ...trigger, ...patch } : trigger,
      ),
    );
  };

  const removeTrigger = (key: string) => {
    onChange(triggers.filter((trigger) => trigger.key !== key));
  };

  const addTrigger = () => {
    onChange([
      ...triggers,
      {
        key: nextDraftTriggerKey(),
        type: "schedule",
        enabled: true,
        config: emptyLoopScheduleTriggerConfig(),
      },
    ]);
  };

  return (
    <Flex direction="column" gap="3">
      {triggers.map((trigger) => (
        <TriggerCard
          key={trigger.key}
          trigger={trigger}
          triggerEndpointPath={triggerEndpointPath}
          disabled={disabled}
          onChange={(patch) => updateTrigger(trigger.key, patch)}
          onRemove={() => removeTrigger(trigger.key)}
        />
      ))}

      <Button
        variant="outline"
        color="gray"
        size="1"
        disabled={disabled}
        onClick={addTrigger}
      >
        <Plus size={12} />
        Add trigger
      </Button>
    </Flex>
  );
}

function TriggerCard({
  trigger,
  triggerEndpointPath,
  disabled,
  onChange,
  onRemove,
}: {
  trigger: LoopTriggerDraft;
  triggerEndpointPath: string | null;
  disabled?: boolean;
  onChange: (patch: Partial<LoopTriggerDraft>) => void;
  onRemove: () => void;
}) {
  const isValid = isTriggerDraftValid(trigger);

  return (
    <Flex
      direction="column"
      gap="3"
      className="rounded-(--radius-2) border border-border bg-(--color-panel-solid) p-3"
    >
      <Flex align="center" justify="between" gap="2">
        <Flex align="center" gap="2" className="min-w-0">
          {triggerTypeIcon(trigger.type)}
          <Box className="min-w-[160px]">
            <SettingsOptionSelect
              value={trigger.type}
              options={TRIGGER_TYPE_OPTIONS}
              disabled={disabled}
              ariaLabel="Trigger type"
              onValueChange={(value) => {
                const type = value as LoopSchemas.LoopTriggerTypeEnum;
                onChange({ type, config: configForType(type) });
              }}
            />
          </Box>
        </Flex>
        <Flex align="center" gap="2">
          <Switch
            checked={trigger.enabled}
            onCheckedChange={(checked) => onChange({ enabled: checked })}
            disabled={disabled}
            aria-label={trigger.enabled ? "Disable trigger" : "Enable trigger"}
          />
          <IconButton
            variant="ghost"
            color="gray"
            size="1"
            aria-label="Remove trigger"
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash size={14} />
          </IconButton>
        </Flex>
      </Flex>

      {!isValid ? (
        <Text className="text-(--red-11) text-[11px]">
          This trigger is missing required fields.
        </Text>
      ) : null}

      {trigger.type === "schedule" ? (
        <ScheduleTriggerFields
          config={trigger.config as LoopSchemas.LoopScheduleTriggerConfig}
          disabled={disabled}
          onChange={(config) => onChange({ config })}
        />
      ) : null}

      {trigger.type === "github" ? (
        <GithubTriggerFields
          config={trigger.config as LoopSchemas.LoopGithubTriggerConfig}
          disabled={disabled}
          onChange={(config) => onChange({ config })}
        />
      ) : null}

      {trigger.type === "api" ? (
        <ApiTriggerFields triggerEndpointPath={triggerEndpointPath} />
      ) : null}
    </Flex>
  );
}

type ScheduleFrequency =
  | "hourly"
  | "daily"
  | "weekdays"
  | "weekly"
  | "once"
  | "custom";

const FREQUENCY_OPTIONS: { value: ScheduleFrequency; label: string }[] = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Weekdays" },
  { value: "weekly", label: "Weekly" },
  { value: "once", label: "Once" },
  { value: "custom", label: "Custom (cron)" },
];

const WEEKDAY_OPTIONS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const DEFAULT_TIME = "09:00";

function localTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

interface ParsedRecurringSchedule {
  frequency: "hourly" | "daily" | "weekdays" | "weekly";
  time: string;
  weekday: string;
}

/** Reads the simple shapes the frequency picker writes; anything else is custom. */
function parseCronSchedule(
  cron: string | null | undefined,
): ParsedRecurringSchedule | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  if (dayOfMonth !== "*" || month !== "*") return null;
  if (!/^\d{1,2}$/.test(minute)) return null;
  if (hour === "*") {
    return dayOfWeek === "*"
      ? { frequency: "hourly", time: DEFAULT_TIME, weekday: "1" }
      : null;
  }
  if (!/^\d{1,2}$/.test(hour)) return null;
  const time = `${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  if (dayOfWeek === "*") return { frequency: "daily", time, weekday: "1" };
  if (dayOfWeek === "1-5") return { frequency: "weekdays", time, weekday: "1" };
  if (/^[0-6]$/.test(dayOfWeek)) {
    return { frequency: "weekly", time, weekday: dayOfWeek };
  }
  return null;
}

function compileCronSchedule(
  frequency: "hourly" | "daily" | "weekdays" | "weekly",
  time: string,
  weekday: string,
): string {
  const [hourPart, minutePart] = time.split(":");
  const hour = Number(hourPart) || 0;
  const minute = Number(minutePart) || 0;
  switch (frequency) {
    case "hourly":
      return "0 * * * *";
    case "daily":
      return `${minute} ${hour} * * *`;
    case "weekdays":
      return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${weekday}`;
  }
}

function ScheduleTriggerFields({
  config,
  disabled,
  onChange,
}: {
  config: LoopSchemas.LoopScheduleTriggerConfig;
  disabled?: boolean;
  onChange: (config: LoopSchemas.LoopScheduleTriggerConfig) => void;
}) {
  const parsed = parseCronSchedule(config.cron_expression);
  // Custom is sticky UI state: "0 9 * * *" typed by hand still parses as
  // daily, so deriving the mode from the config alone would bounce the user
  // out of the cron editor while they type.
  const [customMode, setCustomMode] = useState(
    () => !config.run_at && !!config.cron_expression && !parsed,
  );
  const frequency: ScheduleFrequency = config.run_at
    ? "once"
    : customMode
      ? "custom"
      : (parsed?.frequency ?? "daily");
  const time = parsed?.time ?? DEFAULT_TIME;
  const weekday = parsed?.weekday ?? "1";
  const timezone = config.timezone || localTimezone();

  const setRecurring = (
    nextFrequency: "hourly" | "daily" | "weekdays" | "weekly",
    nextTime: string,
    nextWeekday: string,
  ) => {
    onChange({
      cron_expression: compileCronSchedule(
        nextFrequency,
        nextTime,
        nextWeekday,
      ),
      timezone,
    });
  };

  const handleFrequencyChange = (value: string) => {
    const next = value as ScheduleFrequency;
    if (next === "once") {
      setCustomMode(false);
      onChange({ run_at: new Date().toISOString() });
      return;
    }
    if (next === "custom") {
      setCustomMode(true);
      onChange({
        cron_expression:
          config.cron_expression ??
          emptyLoopScheduleTriggerConfig().cron_expression,
        timezone,
      });
      return;
    }
    setCustomMode(false);
    setRecurring(next, time, weekday);
  };

  const timeInput = (
    <input
      type="time"
      disabled={disabled}
      value={time}
      className="h-8 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-2 text-[12.5px] text-gray-12"
      onChange={(e) => {
        if (!e.target.value || frequency === "custom" || frequency === "once")
          return;
        setRecurring(
          frequency as "daily" | "weekdays" | "weekly",
          e.target.value,
          weekday,
        );
      }}
    />
  );

  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2" wrap="wrap">
        <Box className="min-w-[150px]">
          <SettingsOptionSelect
            value={frequency}
            options={FREQUENCY_OPTIONS}
            disabled={disabled}
            ariaLabel="Frequency"
            onValueChange={handleFrequencyChange}
          />
        </Box>

        {frequency === "daily" ||
        frequency === "weekdays" ||
        frequency === "weekly"
          ? timeInput
          : null}

        {frequency === "weekly" ? (
          <Box className="min-w-[140px]">
            <SettingsOptionSelect
              value={weekday}
              options={WEEKDAY_OPTIONS}
              disabled={disabled}
              ariaLabel="Day of week"
              onValueChange={(value) => setRecurring("weekly", time, value)}
            />
          </Box>
        ) : null}

        {frequency === "once" ? (
          <input
            type="datetime-local"
            disabled={disabled}
            className="h-8 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-2 text-[12.5px] text-gray-12"
            value={config.run_at ? toDatetimeLocal(config.run_at) : ""}
            onChange={(e) =>
              onChange({
                run_at: e.target.value
                  ? new Date(e.target.value).toISOString()
                  : undefined,
              })
            }
          />
        ) : null}
      </Flex>

      {frequency === "custom" ? (
        <Flex gap="2" wrap="wrap">
          <Flex direction="column" gap="1" className="min-w-[160px] flex-1">
            <Text className="text-[12px] text-gray-10">Cron expression</Text>
            <TextField.Root
              size="2"
              value={config.cron_expression ?? ""}
              placeholder="0 9 * * *"
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...config, cron_expression: e.target.value })
              }
            />
          </Flex>
          <Flex direction="column" gap="1" className="min-w-[160px] flex-1">
            <Text className="text-[12px] text-gray-10">Timezone</Text>
            <TextField.Root
              size="2"
              value={config.timezone ?? ""}
              placeholder="UTC"
              disabled={disabled}
              onChange={(e) =>
                onChange({ ...config, timezone: e.target.value })
              }
            />
          </Flex>
        </Flex>
      ) : frequency !== "once" ? (
        <Text className="text-[11px] text-gray-9">Times in {timezone}</Text>
      ) : null}
    </Flex>
  );
}

function toDatetimeLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function GithubTriggerFields({
  config,
  disabled,
  onChange,
}: {
  config: LoopSchemas.LoopGithubTriggerConfig;
  disabled?: boolean;
  onChange: (config: LoopSchemas.LoopGithubTriggerConfig) => void;
}) {
  const toggleEvent = (
    event: LoopSchemas.LoopGithubTriggerEventEnum,
    checked: boolean,
  ) => {
    const events = checked
      ? [...config.events, event]
      : config.events.filter((e) => e !== event);
    onChange({ ...config, events });
  };

  return (
    <Flex direction="column" gap="2">
      <Flex direction="column" gap="1">
        <Text className="text-[12px] text-gray-10">Repository</Text>
        <LoopRepositoryPicker
          value={
            config.repository
              ? {
                  github_integration_id: config.github_integration_id,
                  full_name: config.repository,
                }
              : null
          }
          disabled={disabled}
          onChange={(repo) =>
            onChange({
              ...config,
              repository: repo?.full_name ?? "",
              github_integration_id: repo?.github_integration_id ?? 0,
            })
          }
        />
      </Flex>

      <Flex direction="column" gap="1">
        <Text className="text-[12px] text-gray-10">Events</Text>
        <Flex direction="column" gap="1">
          {GITHUB_EVENT_OPTIONS.map((option) => (
            <Text
              key={option.value}
              as="label"
              className="flex items-center gap-2 text-[12.5px] text-gray-12"
            >
              <Checkbox
                checked={config.events.includes(option.value)}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  toggleEvent(option.value, checked === true)
                }
              />
              {option.label}
            </Text>
          ))}
        </Flex>
      </Flex>
    </Flex>
  );
}

function ApiTriggerFields({
  triggerEndpointPath,
}: {
  triggerEndpointPath: string | null;
}) {
  return (
    <Flex direction="column" gap="2">
      <Text className="text-[12.5px] text-gray-11 leading-snug">
        Fires on an authenticated POST from your own code. Authenticate with a
        project secret API key (<code>phs_...</code>) scoped to{" "}
        <code>loop:write</code>. The request body becomes the run's trigger
        context.
      </Text>
      {triggerEndpointPath ? (
        <Flex align="center" gap="1">
          <Text className="rounded-(--radius-1) border border-border bg-(--gray-2) px-1.5 py-0.5 text-[12px] text-gray-12 [font-family:var(--font-mono)]">
            POST {triggerEndpointPath}
          </Text>
          <CopyButton text={triggerEndpointPath} />
        </Flex>
      ) : (
        <Text className="text-[12px] text-gray-10">
          Save the loop to get its trigger URL.
        </Text>
      )}
    </Flex>
  );
}
