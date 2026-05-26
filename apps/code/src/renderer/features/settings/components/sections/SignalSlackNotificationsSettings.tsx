import { useSignalSourceManager } from "@features/inbox/hooks/useSignalSourceManager";
import { useSlackChannels } from "@features/inbox/hooks/useSlackChannels";
import { useSlackConnect } from "@features/integrations/hooks/useSlackConnect";
import { useIntegrationSelectors } from "@features/integrations/stores/integrationStore";
import { ModalInlineComboboxContent } from "@features/settings/components/ModalInlineComboboxContent";
import { SettingsOptionSelect } from "@features/settings/components/SettingsOptionSelect";
import { useDebouncedValue } from "@hooks/useDebouncedValue";
import { CaretDown, Hash, Lock } from "@phosphor-icons/react";
import {
  Button,
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxTrigger,
} from "@posthog/quill";
import { Callout, Flex, Text } from "@radix-ui/themes";
import type { SignalReportPriority, SlackChannelOption } from "@shared/types";
import { useMemo, useRef, useState } from "react";

const NOTIFY_OFF_VALUE = "__off__";
const NOTIFY_ALL_VALUE = "__all__";
const SLACK_CHANNEL_SEARCH_DEBOUNCE_MS = 300;

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

function buildChannelTargetValue(
  channelId: string,
  channelName: string,
): string {
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
}

export function SignalSlackNotificationsSettings({
  channelComboboxModal = false,
}: SignalSlackNotificationsSettingsProps) {
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

  const channelAnchorRef = useRef<HTMLDivElement>(null);
  const [channelComboboxOpen, setChannelComboboxOpen] = useState(false);
  const [channelSearchQuery, setChannelSearchQuery] = useState("");
  const {
    debounced: debouncedChannelSearch,
    isPending: channelSearchDebouncing,
  } = useDebouncedValue(
    channelSearchQuery.trim(),
    SLACK_CHANNEL_SEARCH_DEBOUNCE_MS,
  );

  const { data: channelsData, isFetching: channelsFetching } = useSlackChannels(
    effectiveIntegrationId,
    {
      search: debouncedChannelSearch || undefined,
      enabled: channelComboboxOpen,
    },
  );
  const channelsSearchPending =
    channelComboboxOpen && (channelsFetching || channelSearchDebouncing);

  const notificationsEnabled =
    !!selectedIntegrationId && !!selectedChannelTarget;

  const visibleChannels = useMemo(() => {
    const channels = [...(channelsData?.channels ?? [])];
    if (
      selectedChannelId &&
      selectedChannelName &&
      !channels.some((channel) => channel.id === selectedChannelId)
    ) {
      channels.unshift(
        configuredSlackChannelOption(selectedChannelId, selectedChannelName),
      );
    }
    return channels;
  }, [channelsData?.channels, selectedChannelId, selectedChannelName]);

  const channelComboboxItems = useMemo(
    () => [NOTIFY_OFF_VALUE, ...visibleChannels.map((c) => c.id)],
    [visibleChannels],
  );

  const integrationOptions = useMemo(
    () =>
      slackIntegrations.map((integration) => ({
        value: String(integration.id),
        label: getSlackIntegrationLabel(integration),
      })),
    [slackIntegrations],
  );

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
            Slack notifications
          </Text>
          <Text className="text-(--gray-11) text-[13px]">
            Get pinged in Slack when you're a suggested reviewer on a new inbox
            item.
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
    if (channelsSearchPending && !notificationsEnabled) {
      return "Loading channels…";
    }
    if (!notificationsEnabled) return "Pick a channel";
    if (selectedChannelName) return selectedChannelName;
    if (selectedChannelId) return selectedChannelId;
    return "Pick a channel";
  })();

  const channelComboboxPanel = (
    <>
      <ComboboxInput placeholder="Search channels…" showTrigger={false} />
      <ComboboxEmpty>
        {channelsSearchPending
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
          const channel = visibleChannels.find((c) => c.id === itemValue);
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
    </>
  );

  const channelComboboxPopupProps = {
    anchor: channelAnchorRef,
    side: "bottom" as const,
    sideOffset: 4,
    className: "min-w-[240px]",
  };

  const connectWorkspaceButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="shrink-0"
      disabled={slackConnect.isConnecting}
      onClick={() => {
        void slackConnect.connect();
      }}
    >
      {slackConnect.isConnecting ? "Waiting…" : "Add workspace"}
    </Button>
  );

  return (
    <Flex
      direction="column"
      gap="2"
      pt="3"
      style={{ borderTop: "1px dashed var(--gray-5)" }}
    >
      <Flex direction="column" gap="1">
        <Text className="font-medium text-(--gray-12) text-sm">
          Slack notifications
        </Text>
        <Text className="text-(--gray-11) text-[13px]">
          Ping in Slack when you're a suggested reviewer on a new inbox item.
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
        {connectWorkspaceButton}
      </Flex>

      <Flex gap="2" wrap="wrap" align="end">
        <Flex direction="column" gap="1" className="min-w-0">
          <Text className="text-(--gray-11) text-[12px]">Channel</Text>
          <div ref={channelAnchorRef} className="inline-flex">
            <Combobox
              items={channelComboboxItems}
              filter={null}
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
              disabled={!effectiveIntegrationId}
              modal={false}
            >
              <ComboboxTrigger
                render={
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!effectiveIntegrationId}
                    aria-label="Notification channel"
                    className={`${SETTINGS_CONTROL_CLASS} justify-between`}
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
                  </Button>
                }
              />
              {channelComboboxModal ? (
                <ModalInlineComboboxContent {...channelComboboxPopupProps}>
                  {channelComboboxPanel}
                </ModalInlineComboboxContent>
              ) : (
                <ComboboxContent {...channelComboboxPopupProps}>
                  {channelComboboxPanel}
                </ComboboxContent>
              )}
            </Combobox>
          </div>
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

function configuredSlackChannelOption(
  id: string,
  name: string,
): SlackChannelOption {
  return {
    id,
    name,
    is_private: false,
    is_member: true,
    is_ext_shared: false,
    is_private_without_access: false,
  };
}
