import { useSignalSourceManager } from "@features/inbox/hooks/useSignalSourceManager";
import { useSlackChannels } from "@features/inbox/hooks/useSlackChannels";
import { useSlackConnect } from "@features/integrations/hooks/useSlackConnect";
import { useIntegrationSelectors } from "@features/integrations/stores/integrationStore";
import { CaretDown, Hash, Lock } from "@phosphor-icons/react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
  Button as QuillButton,
} from "@posthog/quill";
import { Box, Button, Callout, Flex, Select, Text } from "@radix-ui/themes";
import type { SignalReportPriority } from "@shared/types";
import { useMemo, useRef, useState } from "react";

const NOTIFY_OFF_VALUE = "__off__";
const NOTIFY_ALL_VALUE = "__all__";
const CHANNEL_COMBOBOX_LIMIT = 50;

const MIN_PRIORITY_OPTIONS: {
  value: SignalReportPriority | typeof NOTIFY_ALL_VALUE;
  label: string;
}[] = [
  {
    value: NOTIFY_ALL_VALUE,
    label: "Every priority (including unprioritized)",
  },
  { value: "P0", label: "P0 only (critical)" },
  { value: "P1", label: "P1 and above" },
  { value: "P2", label: "P2 and above" },
  { value: "P3", label: "P3 and above" },
  { value: "P4", label: "P4 and above" },
];

function buildChannelTargetValue(
  channelId: string,
  channelName: string,
): string {
  // Mirror the convention used by the rest of PostHog: `channelId|#channel-name`.
  const display = channelName.startsWith("#") ? channelName : `#${channelName}`;
  return `${channelId}|${display}`;
}

function parseChannelIdFromTargetValue(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return value.split("|")[0]?.trim() || null;
}

function parseChannelNameFromTargetValue(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const display = value.split("|")[1]?.trim();
  if (!display) return null;
  return display.startsWith("#") ? display.slice(1) : display;
}

export function SignalSlackNotificationsSettings() {
  const { slackIntegrations, hasSlackIntegration } = useIntegrationSelectors();
  const { userAutonomyConfig, handleUpdateSlackNotifications } =
    useSignalSourceManager();
  const slackConnect = useSlackConnect();

  const selectedIntegrationId =
    userAutonomyConfig?.slack_notification_integration_id ?? null;
  const selectedChannelTarget =
    userAutonomyConfig?.slack_notification_channel ?? null;
  const selectedChannelId = parseChannelIdFromTargetValue(
    selectedChannelTarget,
  );
  const selectedChannelName = parseChannelNameFromTargetValue(
    selectedChannelTarget,
  );
  const minPriority =
    userAutonomyConfig?.slack_notification_min_priority ?? null;

  // Default the integration selection to the first one if there's only one
  // available — we still require an explicit channel pick to enable delivery.
  const effectiveIntegrationId =
    selectedIntegrationId ??
    (slackIntegrations.length === 1 ? slackIntegrations[0].id : null);

  const { data: channelsData, isPending: channelsLoading } = useSlackChannels(
    effectiveIntegrationId,
  );

  const notificationsEnabled =
    !!selectedIntegrationId && !!selectedChannelTarget;

  const channelAnchorRef = useRef<HTMLDivElement>(null);
  const [channelComboboxOpen, setChannelComboboxOpen] = useState(false);
  const [channelSearchQuery, setChannelSearchQuery] = useState("");

  const visibleChannels = useMemo(
    () =>
      (channelsData?.channels ?? []).filter(
        (c) => !c.is_private_without_access,
      ),
    [channelsData?.channels],
  );

  const channelComboboxItems = useMemo(
    () => [NOTIFY_OFF_VALUE, ...visibleChannels.map((c) => c.id)],
    [visibleChannels],
  );

  if (!hasSlackIntegration) {
    return (
      <Flex
        direction="column"
        gap="2"
        pt="4"
        style={{ borderTop: "1px dashed var(--gray-5)" }}
      >
        <Text className="font-medium text-(--gray-12) text-sm">
          Slack notifications for new inbox items
        </Text>
        <Text className="text-(--gray-11) text-[13px]">
          Get pinged in Slack when a new inbox item lands and you're a suggested
          reviewer. Connect a Slack workspace to your PostHog project to get
          started — your browser opens, you approve the install, and you'll be
          brought back here automatically.
        </Text>
        <Box>
          <Button
            size="1"
            variant="soft"
            disabled={slackConnect.isConnecting}
            onClick={() => {
              void slackConnect.connect();
            }}
          >
            {slackConnect.isConnecting
              ? "Waiting for Slack…"
              : "Connect Slack workspace"}
          </Button>
        </Box>
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

  const onChannelComboboxChange = (rawValue: string | null) => {
    setChannelComboboxOpen(false);
    setChannelSearchQuery("");
    if (rawValue === null) return;
    if (rawValue === NOTIFY_OFF_VALUE) {
      void handleUpdateSlackNotifications({ channel: null });
      return;
    }
    if (!effectiveIntegrationId) return;
    const channel = visibleChannels.find((c) => c.id === rawValue);
    if (!channel) return;
    void handleUpdateSlackNotifications({
      integrationId: effectiveIntegrationId,
      channel: buildChannelTargetValue(channel.id, channel.name),
    });
  };

  const onIntegrationChange = (value: string) => {
    const integrationId = Number(value);
    if (!Number.isFinite(integrationId)) return;
    // Switching workspaces clears the channel — the previously picked
    // channel won't exist in the new workspace.
    void handleUpdateSlackNotifications({
      integrationId,
      channel: null,
    });
  };

  const onMinPriorityChange = (value: string) => {
    void handleUpdateSlackNotifications({
      minPriority: value === NOTIFY_ALL_VALUE ? null : value,
    });
  };

  const channelTriggerLabel = (() => {
    if (channelsLoading && !notificationsEnabled) return "Loading channels…";
    if (!notificationsEnabled) return "Pick a channel";
    if (selectedChannelName) return `#${selectedChannelName}`;
    if (selectedChannelId) return selectedChannelId;
    return "Pick a channel";
  })();

  return (
    <Flex
      direction="column"
      gap="3"
      pt="4"
      style={{ borderTop: "1px dashed var(--gray-5)" }}
    >
      <Text className="font-medium text-(--gray-12) text-sm">
        Slack notifications for new inbox items
      </Text>
      <Text className="text-(--gray-11) text-[13px]">
        When a new inbox item lands and you're a suggested reviewer, PostHog
        posts a Slack message in the channel you select. Pick a minimum priority
        to filter out lower-urgency reports.
      </Text>

      {slackIntegrations.length > 1 ? (
        <Flex direction="column" gap="1">
          <Text className="text-(--gray-11) text-[12px]">Slack workspace</Text>
          <Select.Root
            value={effectiveIntegrationId ? String(effectiveIntegrationId) : ""}
            onValueChange={onIntegrationChange}
          >
            <Select.Trigger
              className="max-w-[300px]"
              placeholder="Select a workspace"
            />
            <Select.Content>
              {slackIntegrations.map((integration) => {
                const label =
                  integration.display_name ??
                  integration.config?.account?.name ??
                  `Slack workspace ${integration.id}`;
                return (
                  <Select.Item
                    key={integration.id}
                    value={String(integration.id)}
                  >
                    {label}
                  </Select.Item>
                );
              })}
            </Select.Content>
          </Select.Root>
        </Flex>
      ) : null}

      <Box>
        <Button
          size="1"
          variant="ghost"
          disabled={slackConnect.isConnecting}
          onClick={() => {
            void slackConnect.connect();
          }}
        >
          {slackConnect.isConnecting
            ? "Waiting for Slack…"
            : "Connect another Slack workspace"}
        </Button>
      </Box>

      <Flex direction="column" gap="1">
        <Text className="text-(--gray-11) text-[12px]">
          Notification channel
        </Text>
        <div ref={channelAnchorRef} className="inline-flex">
          <Combobox
            items={channelComboboxItems}
            limit={CHANNEL_COMBOBOX_LIMIT}
            value={
              notificationsEnabled && selectedChannelId
                ? selectedChannelId
                : NOTIFY_OFF_VALUE
            }
            onValueChange={(v) => onChannelComboboxChange(v as string | null)}
            open={channelComboboxOpen}
            onOpenChange={(open) => {
              setChannelComboboxOpen(open);
              if (!open) setChannelSearchQuery("");
            }}
            inputValue={channelSearchQuery}
            onInputValueChange={(v) => setChannelSearchQuery(v ?? "")}
            disabled={!effectiveIntegrationId || channelsLoading}
          >
            <ComboboxTrigger
              render={
                <QuillButton
                  variant="outline"
                  size="sm"
                  disabled={!effectiveIntegrationId || channelsLoading}
                  aria-label="Notification channel"
                  className="min-w-[260px] max-w-[300px] justify-between"
                >
                  <span className="flex min-w-0 items-center gap-1">
                    {notificationsEnabled && selectedChannelId ? (
                      <Hash size={12} weight="regular" className="shrink-0" />
                    ) : null}
                    <span className="min-w-0 truncate">
                      {channelTriggerLabel}
                    </span>
                  </span>
                  <CaretDown
                    size={10}
                    weight="bold"
                    className="shrink-0 text-muted-foreground"
                  />
                </QuillButton>
              }
            />
            <ComboboxContent
              anchor={channelAnchorRef}
              side="bottom"
              sideOffset={6}
              className="min-w-[300px]"
            >
              <ComboboxInput
                placeholder="Search channels…"
                showTrigger={false}
              />
              <ComboboxEmpty>
                {channelsLoading
                  ? "Loading channels…"
                  : "No channels match — make sure PostHog is in the channel."}
              </ComboboxEmpty>
              <ComboboxList className="max-h-[min(18rem,calc(var(--available-height,18rem)-5rem))]">
                {(itemValue: string) => {
                  if (itemValue === NOTIFY_OFF_VALUE) {
                    return (
                      <ComboboxItem
                        key={NOTIFY_OFF_VALUE}
                        value={NOTIFY_OFF_VALUE}
                        title="Off — don't notify me"
                      >
                        Off — don't notify me
                      </ComboboxItem>
                    );
                  }
                  const channel = visibleChannels.find(
                    (c) => c.id === itemValue,
                  );
                  if (!channel) return null;
                  const Icon = channel.is_private ? Lock : Hash;
                  return (
                    <ComboboxItem
                      key={channel.id}
                      value={channel.id}
                      title={channel.name}
                    >
                      <Icon size={12} weight="regular" className="shrink-0" />
                      <span className="min-w-0 truncate">{channel.name}</span>
                      {channel.is_ext_shared ? (
                        <span className="ms-1 shrink-0 text-muted-foreground text-xs">
                          (shared)
                        </span>
                      ) : null}
                    </ComboboxItem>
                  );
                }}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        <Text className="text-(--gray-10) text-[12px]">
          PostHog needs to be a member of the channel to post. Invite it with{" "}
          <code>/invite @PostHog</code> in Slack if delivery fails.
        </Text>
      </Flex>

      <Flex direction="column" gap="1">
        <Text className="text-(--gray-11) text-[12px]">
          Minimum priority to notify
        </Text>
        <Select.Root
          value={minPriority ?? NOTIFY_ALL_VALUE}
          disabled={!notificationsEnabled}
          onValueChange={onMinPriorityChange}
        >
          <Select.Trigger className="max-w-[300px]" />
          <Select.Content>
            {MIN_PRIORITY_OPTIONS.map((opt) => (
              <Select.Item key={opt.value} value={opt.value}>
                {opt.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </Flex>
    </Flex>
  );
}
