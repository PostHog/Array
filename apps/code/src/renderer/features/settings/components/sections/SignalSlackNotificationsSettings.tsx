import { useSignalSourceManager } from "@features/inbox/hooks/useSignalSourceManager";
import { useSlackConnect } from "@features/integrations/hooks/useSlackConnect";
import { useIntegrationSelectors } from "@features/integrations/stores/integrationStore";
import { SettingsOptionSelect } from "@features/settings/components/SettingsOptionSelect";
import { SlackChannelCombobox } from "@features/settings/components/SlackChannelCombobox";
import { Button } from "@posthog/quill";
import { Box, Callout, Flex, Text } from "@radix-ui/themes";
import type { SignalReportPriority } from "@shared/types";
import { useMemo } from "react";

const NOTIFY_ALL_VALUE = "__all__";

const MIN_PRIORITY_OPTIONS: {
  value: SignalReportPriority | typeof NOTIFY_ALL_VALUE;
  label: string;
}[] = [
  { value: NOTIFY_ALL_VALUE, label: "All priorities" },
  { value: "P0", label: "P0 only" },
  { value: "P1", label: "P1 and above" },
  { value: "P2", label: "P2 and above" },
  { value: "P3", label: "P3 and above" },
  { value: "P4", label: "P4 and above" },
];

const SETTINGS_CONTROL_CLASS = "min-w-[200px] max-w-[240px]";

function getSlackIntegrationLabel(integration: {
  id: number;
  display_name?: string;
  config?: { account?: { name?: string } };
}): string {
  return (
    integration.display_name ??
    integration.config?.account?.name ??
    `Slack workspace ${integration.id}`
  );
}

interface SignalSlackNotificationsSettingsProps {
  channelComboboxModal?: boolean;
  isLoading?: boolean;
}

export function SignalSlackNotificationsSettings({
  channelComboboxModal = false,
  isLoading = false,
}: SignalSlackNotificationsSettingsProps) {
  const { slackIntegrations, hasSlackIntegration } = useIntegrationSelectors();
  const { userAutonomyConfig, handleUpdateSlackNotifications } =
    useSignalSourceManager();
  const slackConnect = useSlackConnect();

  const selectedIntegrationId =
    userAutonomyConfig?.slack_notification_integration_id ?? null;
  const selectedChannelTarget =
    userAutonomyConfig?.slack_notification_channel ?? null;
  const minPriority =
    userAutonomyConfig?.slack_notification_min_priority ?? null;

  // Default the integration selection to the first one if there's only one
  // available — we still require an explicit channel pick to enable delivery.
  const effectiveIntegrationId =
    selectedIntegrationId ??
    (slackIntegrations.length === 1 ? slackIntegrations[0].id : null);

  const notificationsEnabled =
    !!selectedIntegrationId && !!selectedChannelTarget;

  const integrationOptions = useMemo(
    () =>
      slackIntegrations.map((integration) => ({
        value: String(integration.id),
        label: getSlackIntegrationLabel(integration),
      })),
    [slackIntegrations],
  );

  if (isLoading) {
    return (
      <Flex
        direction="column"
        gap="2"
        pt="3"
        className="border-(--gray-5) border-t border-dashed"
      >
        <Flex direction="column" gap="1">
          <Box className="h-[14px] w-[160px] animate-pulse rounded bg-gray-4" />
          <Box className="h-[11px] w-[80%] animate-pulse rounded bg-gray-3" />
        </Flex>
        <Box className="mt-1 h-[28px] w-[200px] animate-pulse rounded bg-gray-3" />
      </Flex>
    );
  }

  if (!hasSlackIntegration) {
    return (
      <Flex
        direction="column"
        gap="2"
        pt="3"
        style={{ borderTop: "1px dashed var(--gray-5)" }}
      >
        <Flex direction="column" gap="1">
          <Text className="font-medium text-(--gray-12) text-sm">
            Notify me directly
          </Text>
          <Text className="text-(--gray-11) text-[13px]">
            Get pinged in your own channel when you're a suggested reviewer on a
            new inbox item.
          </Text>
        </Flex>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={slackConnect.isConnecting}
          onClick={() => {
            void slackConnect.connect();
          }}
          className="w-fit"
        >
          {slackConnect.isConnecting
            ? "Waiting for Slack…"
            : "Connect Slack workspace"}
        </Button>
        {slackConnect.hasError && slackConnect.error ? (
          <Callout.Root size="1" color="red" variant="soft">
            <Callout.Text>{slackConnect.error.message}</Callout.Text>
          </Callout.Root>
        ) : null}
        {slackConnect.isTimedOut ? (
          <Callout.Root size="1" color="gray" variant="soft">
            <Callout.Text>
              We didn't hear back from PostHog. If you completed the connection
              in your browser it should appear shortly — otherwise try again.
            </Callout.Text>
          </Callout.Root>
        ) : null}
      </Flex>
    );
  }

  const onChannelChange = (channel: string | null) => {
    if (channel === null) {
      void handleUpdateSlackNotifications({ channel: null });
      return;
    }
    if (!effectiveIntegrationId) return;
    void handleUpdateSlackNotifications({
      integrationId: effectiveIntegrationId,
      channel,
    });
  };

  const onIntegrationChange = (value: string) => {
    const integrationId = Number(value);
    if (!Number.isFinite(integrationId)) return;
    // Switching workspaces clears the channel — the previously picked
    // channel won't exist in the new workspace.
    void handleUpdateSlackNotifications({ integrationId, channel: null });
  };

  const onMinPriorityChange = (value: string) => {
    void handleUpdateSlackNotifications({
      minPriority: value === NOTIFY_ALL_VALUE ? null : value,
    });
  };

  return (
    <Flex
      direction="column"
      gap="2"
      pt="3"
      style={{ borderTop: "1px dashed var(--gray-5)" }}
    >
      <Flex direction="column" gap="1">
        <Text className="font-medium text-(--gray-12) text-sm">
          Notify me directly
        </Text>
        <Text className="text-(--gray-11) text-[13px]">
          Ping you in your own channel when you're a suggested reviewer — on top
          of the team's default channel above.
        </Text>
      </Flex>

      <Flex align="center" justify="between" gap="2" wrap="wrap">
        <Flex align="center" gap="2" className="min-w-0">
          <Text className="shrink-0 text-(--gray-11) text-[12px]">
            Workspace
          </Text>
          {slackIntegrations.length > 1 ? (
            <SettingsOptionSelect
              value={
                effectiveIntegrationId ? String(effectiveIntegrationId) : ""
              }
              options={integrationOptions}
              ariaLabel="Slack workspace"
              placeholder="Select workspace"
              className={`${SETTINGS_CONTROL_CLASS} min-w-[160px]`}
              onValueChange={onIntegrationChange}
            />
          ) : slackIntegrations[0] ? (
            <Text className="truncate font-medium text-(--gray-12) text-[13px]">
              {getSlackIntegrationLabel(slackIntegrations[0])}
            </Text>
          ) : null}
        </Flex>
      </Flex>

      <Flex gap="2" wrap="wrap" align="end">
        <Flex direction="column" gap="1" className="min-w-0">
          <Text className="text-(--gray-11) text-[12px]">Channel</Text>
          <SlackChannelCombobox
            integrationId={effectiveIntegrationId}
            value={selectedChannelTarget}
            onChange={onChannelChange}
            offLabel="Off — don't notify me"
            ariaLabel="Notification channel"
            modal={channelComboboxModal}
            disabled={!effectiveIntegrationId}
          />
        </Flex>
        <Flex direction="column" gap="1" className="min-w-0">
          <Text className="text-(--gray-11) text-[12px]">Min. priority</Text>
          <SettingsOptionSelect
            value={minPriority ?? NOTIFY_ALL_VALUE}
            options={MIN_PRIORITY_OPTIONS}
            ariaLabel="Minimum priority to notify"
            disabled={!notificationsEnabled}
            className={SETTINGS_CONTROL_CLASS}
            onValueChange={onMinPriorityChange}
          />
        </Flex>
      </Flex>
      <Text className="text-(--gray-10) text-[11px]">
        PostHog must be in the channel — invite with{" "}
        <code className="text-[11px]">/invite @PostHog</code>
      </Text>
    </Flex>
  );
}
