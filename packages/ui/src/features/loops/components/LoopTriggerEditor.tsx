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

type ScheduleMode = "recurring" | "one_time";

function scheduleModeOf(
  config: LoopSchemas.LoopScheduleTriggerConfig,
): ScheduleMode {
  return config.run_at ? "one_time" : "recurring";
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
  const mode = scheduleModeOf(config);

  return (
    <Flex direction="column" gap="2">
      <Box className="max-w-[220px]">
        <SettingsOptionSelect
          value={mode}
          options={[
            { value: "recurring", label: "Recurring (cron)" },
            { value: "one_time", label: "One-time" },
          ]}
          disabled={disabled}
          ariaLabel="Schedule mode"
          onValueChange={(value) =>
            onChange(
              value === "one_time"
                ? { run_at: new Date().toISOString() }
                : emptyLoopScheduleTriggerConfig(),
            )
          }
        />
      </Box>

      {mode === "recurring" ? (
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
      ) : (
        <Flex direction="column" gap="1" className="max-w-[240px]">
          <Text className="text-[12px] text-gray-10">Run at</Text>
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
        </Flex>
      )}
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
