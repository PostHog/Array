import { DataSourceSetup } from "@features/inbox/components/DataSourceSetup";
import {
  SignalSourceToggles,
  SignalSourceTogglesSkeleton,
} from "@features/inbox/components/SignalSourceToggles";
import { useSignalSourceManager } from "@features/inbox/hooks/useSignalSourceManager";
import { SettingsOptionSelect } from "@features/settings/components/SettingsOptionSelect";
import { GitHubIntegrationSection } from "@features/settings/components/sections/GitHubIntegrationSection";
import { SlackInboxNotificationsSettings } from "@features/settings/components/sections/SlackInboxNotificationsSettings";
import { openSettings } from "@features/settings/hooks/useOpenSettings";
import { useRepositoryIntegration } from "@hooks/useIntegrations";
import { ArrowRightIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { Box, Flex, Text, Tooltip } from "@radix-ui/themes";
import type { SignalReportPriority } from "@shared/types";

const PRIORITY_OPTIONS: { value: SignalReportPriority; label: string }[] = [
  { value: "P0", label: "P0 — Critical only" },
  { value: "P1", label: "P1 — High and above" },
  { value: "P2", label: "P2 — Medium and above" },
  { value: "P3", label: "P3 — Low and above" },
  { value: "P4", label: "P4 — All priorities" },
];

const NEVER_VALUE = "__never__";

const USER_PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: NEVER_VALUE, label: "Never – opt out of auto-assigned tasks" },
  ...PRIORITY_OPTIONS,
];

interface SignalSourcesSettingsProps {
  /** Slack channel combobox is inside a Radix modal dialog (Inbox configuration). */
  slackNotificationsInModal?: boolean;
  /**
   * Render the Slack inbox-notification config inline. True in the inbox setup
   * flow (where picking a channel is part of onboarding); false in the Settings
   * dialog's Signals section, which links out to the dedicated Slack section.
   */
  showSlackNotifications?: boolean;
}

export function SignalSourcesSettings({
  slackNotificationsInModal = false,
  showSlackNotifications = true,
}: SignalSourcesSettingsProps) {
  const {
    displayValues,
    sourceStates,
    setupSource,
    isLoading,
    handleToggle,
    handleSetup,
    handleSetupComplete,
    handleSetupCancel,
    userAutonomyConfig,
    userAutonomyConfigLoading,
    handleUpdateUserAutonomyPriority,
  } = useSignalSourceManager();

  const { hasGithubIntegration, isLoadingIntegrations } =
    useRepositoryIntegration();

  const userPriorityValue =
    userAutonomyConfig?.autostart_priority ?? NEVER_VALUE;

  return (
    <Flex direction="column" gap="4">
      <Text className="text-(--gray-11) text-sm">
        Connect GitHub and pick which sources to monitor. PostHog Code will
        analyze activity around the clock and surface ready-to-merge fixes and
        improvements.
      </Text>

      <GitHubIntegrationSection
        hasGithubIntegration={hasGithubIntegration}
        isLoading={isLoadingIntegrations}
      />

      {isLoading ? (
        <SignalSourceTogglesSkeleton />
      ) : (
        <Tooltip
          content="Connect code access to configure signal sources"
          hidden={hasGithubIntegration}
        >
          <Box>
            <Box
              style={
                !hasGithubIntegration
                  ? { opacity: 0.45, pointerEvents: "none" }
                  : undefined
              }
            >
              {setupSource ? (
                <DataSourceSetup
                  source={setupSource}
                  onComplete={() => void handleSetupComplete()}
                  onCancel={handleSetupCancel}
                />
              ) : (
                <SignalSourceToggles
                  value={displayValues}
                  onToggle={(source, enabled) =>
                    void handleToggle(source, enabled)
                  }
                  disabled={!hasGithubIntegration}
                  sourceStates={sourceStates}
                  onSetup={handleSetup}
                />
              )}
            </Box>
          </Box>
        </Tooltip>
      )}
      <Flex
        direction="column"
        gap="2"
        pt="3"
        style={{ borderTop: "1px dashed var(--gray-5)" }}
      >
        <Flex direction="column" gap="1">
          <Flex align="center" gap="2">
            <Box className="shrink-0 text-(--gray-11)">
              <GithubLogoIcon size={16} />
            </Box>
            <Text className="font-medium text-(--gray-12) text-sm">
              Your PR auto-start threshold
            </Text>
          </Flex>
          <Text className="text-(--gray-11) text-[13px]">
            Automatically start tasks assigned to you for reports at or above
            this priority. These count toward your usage. Choose
            &quot;Never&quot; to opt out.
          </Text>
        </Flex>
        {userAutonomyConfigLoading ? (
          <Box className="h-[32px] w-[260px] animate-pulse rounded bg-gray-3" />
        ) : (
          <SettingsOptionSelect
            value={userPriorityValue}
            options={USER_PRIORITY_OPTIONS}
            ariaLabel="PR auto-start threshold"
            className="min-w-[260px] max-w-[300px]"
            onValueChange={(value) =>
              void handleUpdateUserAutonomyPriority(
                value === NEVER_VALUE ? null : value,
              )
            }
          />
        )}
      </Flex>
      {showSlackNotifications ? (
        <SlackInboxNotificationsSettings
          channelComboboxModal={slackNotificationsInModal}
          isLoading={isLoadingIntegrations}
        />
      ) : (
        <Flex
          align="center"
          justify="between"
          gap="2"
          pt="3"
          wrap="wrap"
          style={{ borderTop: "1px dashed var(--gray-5)" }}
        >
          <Flex direction="column" gap="1" className="min-w-0">
            <Text className="font-medium text-(--gray-12) text-sm">
              Slack notifications
            </Text>
            <Text className="text-(--gray-11) text-[13px]">
              Choose where ready inbox reports are posted and who gets pinged.
            </Text>
          </Flex>
          <button
            type="button"
            className="flex shrink-0 cursor-pointer items-center gap-1 border-0 bg-transparent text-[13px] text-accent-11 transition-colors hover:text-accent-12"
            onClick={() => openSettings("slack")}
          >
            Manage in Slack settings
            <ArrowRightIcon size={13} />
          </button>
        </Flex>
      )}
    </Flex>
  );
}
