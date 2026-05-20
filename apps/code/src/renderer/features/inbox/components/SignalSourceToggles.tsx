import { Badge } from "@components/ui/Badge";
import { PgAnalyzeIcon } from "@features/inbox/components/utils/PgAnalyzeIcon";
import {
  ArrowSquareOutIcon,
  BrainIcon,
  BugIcon,
  ChatsIcon,
  CircleNotchIcon,
  GithubLogoIcon,
  KanbanIcon,
  TicketIcon,
  VideoIcon,
} from "@phosphor-icons/react";
import {
  Box,
  Button,
  Flex,
  Spinner,
  Switch,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import type { SignalSourceConfig } from "@renderer/api/posthogClient";
import { memo, useCallback } from "react";

export interface SignalSourceValues {
  session_replay: boolean;
  error_tracking: boolean;
  github: boolean;
  linear: boolean;
  zendesk: boolean;
  conversations: boolean;
  pganalyze: boolean;
}

interface SignalSourceToggleCardProps {
  icon: React.ReactNode;
  label: string;
  labelSuffix?: React.ReactNode;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  requiresSetup?: boolean;
  onSetup?: () => void;
  loading?: boolean;
  statusSection?: React.ReactNode;
  syncStatus?: string | null;
  docsUrl?: string;
  docsLabel?: string;
}

function syncStatusLabel(status: string | null | undefined): {
  text: string;
  color: string;
} | null {
  if (!status) return null;
  switch (status) {
    case "running":
      return { text: "Syncing…", color: "var(--amber-11)" };
    case "completed":
      return { text: "Synced", color: "var(--green-11)" };
    case "failed":
      return { text: "Sync failed", color: "var(--red-11)" };
    default:
      return null;
  }
}

const SignalSourceToggleCard = memo(function SignalSourceToggleCard({
  icon,
  label,
  labelSuffix,
  description,
  checked,
  onCheckedChange,
  disabled,
  requiresSetup,
  onSetup,
  loading,
  statusSection,
  syncStatus,
  docsUrl,
  docsLabel,
}: SignalSourceToggleCardProps) {
  const statusInfo = checked ? syncStatusLabel(syncStatus) : null;

  return (
    <Box
      p="3"
      onClick={
        disabled || loading
          ? undefined
          : requiresSetup
            ? onSetup
            : () => onCheckedChange(!checked)
      }
      className={`rounded-(--radius-3) border border-(--gray-4) bg-(--color-panel-solid) ${disabled || loading ? "cursor-default" : "cursor-pointer"}`}
    >
      <Flex align="center" justify="between" gap="4">
        <Flex align="center" gap="3">
          <Box className="shrink-0 text-(--gray-11)">{icon}</Box>
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              <Text className="font-medium text-(--gray-12) text-sm">
                {label}
              </Text>
              {labelSuffix}
              {statusInfo && (
                <Text
                  style={{ color: statusInfo.color }}
                  className="text-[13px]"
                >
                  {statusInfo.text}
                </Text>
              )}
            </Flex>
            <Text className="text-(--gray-11) text-[13px]">{description}</Text>
            {docsUrl && (
              <Text className="text-(--gray-11) text-[13px]">
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    window.open(docsUrl, "_blank", "noopener");
                  }}
                  className="inline-flex items-center gap-[4px] text-(--accent-11) no-underline"
                >
                  Learn about {docsLabel ?? label}
                  <ArrowSquareOutIcon size={11} />
                </a>
              </Text>
            )}
          </Flex>
        </Flex>
        {loading ? (
          <Spinner size="2" />
        ) : requiresSetup ? (
          <Button
            size="1"
            onClick={(e) => {
              e.stopPropagation();
              onSetup?.();
            }}
          >
            Enable
          </Button>
        ) : (
          <Switch
            checked={checked}
            onCheckedChange={onCheckedChange}
            disabled={disabled}
            onClick={(e) => e.stopPropagation()}
          />
        )}
      </Flex>
      {statusSection && <Box className="ml-[32px]">{statusSection}</Box>}
    </Box>
  );
});

interface EvaluationsSectionProps {
  evaluationsUrl: string;
}

export const EvaluationsSection = memo(function EvaluationsSection({
  evaluationsUrl,
}: EvaluationsSectionProps) {
  return (
    <Box
      p="3"
      onClick={() => window.open(evaluationsUrl, "_blank", "noopener")}
      className="cursor-pointer rounded-(--radius-3) border border-(--gray-4) bg-(--color-panel-solid)"
    >
      <Flex align="center" justify="between" gap="4">
        <Flex align="center" gap="3">
          <Box className="shrink-0 text-(--gray-11)">
            <BrainIcon size={20} />
          </Box>
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              <Text className="font-medium text-(--gray-12) text-sm">
                LLM Analytics
              </Text>
              <Tooltip content="This is only visible to staff users of PostHog">
                <Badge color="blue">Internal</Badge>
              </Tooltip>
            </Flex>
            <Text className="text-(--gray-11) text-[13px]">
              Monitor how your AI features are performing
            </Text>
            <Text className="text-(--gray-11) text-[13px]">
              <a
                href="https://posthog.com/docs/llm-analytics"
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  window.open(
                    "https://posthog.com/docs/llm-analytics",
                    "_blank",
                    "noopener",
                  );
                }}
                className="inline-flex items-center gap-[4px] text-(--accent-11) no-underline"
              >
                Learn about LLM Analytics
                <ArrowSquareOutIcon size={11} />
              </a>
            </Text>
          </Flex>
        </Flex>
        <Button
          size="1"
          onClick={(e) => {
            e.stopPropagation();
            window.open(evaluationsUrl, "_blank", "noopener");
          }}
        >
          Open
          <ArrowSquareOutIcon size={12} />
        </Button>
      </Flex>
    </Box>
  );
});

function SourceRunningIndicator({
  status,
  message,
}: {
  status: SignalSourceConfig["status"];
  message: string;
}) {
  if (status !== "running") {
    return null;
  }
  return (
    <Flex align="center" gap="2" mt="2">
      <CircleNotchIcon size={14} className="animate-spin text-(--accent-11)" />
      <Text className="text-(--accent-11) text-[13px]">{message}</Text>
    </Flex>
  );
}

interface SignalSourceTogglesProps {
  value: SignalSourceValues;
  onToggle: (source: keyof SignalSourceValues, enabled: boolean) => void;
  disabled?: boolean;
  sourceStates?: Partial<
    Record<
      keyof SignalSourceValues,
      {
        requiresSetup: boolean;
        loading: boolean;
        syncStatus?: SignalSourceConfig["status"];
      }
    >
  >;
  onSetup?: (source: keyof SignalSourceValues) => void;
  evaluationsUrl?: string;
}

export function SignalSourceToggles({
  value,
  onToggle,
  disabled,
  sourceStates,
  onSetup,
  evaluationsUrl,
}: SignalSourceTogglesProps) {
  const toggleSessionReplay = useCallback(
    (checked: boolean) => onToggle("session_replay", checked),
    [onToggle],
  );
  const toggleErrorTracking = useCallback(
    (checked: boolean) => onToggle("error_tracking", checked),
    [onToggle],
  );
  const toggleGithub = useCallback(
    (checked: boolean) => onToggle("github", checked),
    [onToggle],
  );
  const toggleLinear = useCallback(
    (checked: boolean) => onToggle("linear", checked),
    [onToggle],
  );
  const toggleZendesk = useCallback(
    (checked: boolean) => onToggle("zendesk", checked),
    [onToggle],
  );
  const toggleConversations = useCallback(
    (checked: boolean) => onToggle("conversations", checked),
    [onToggle],
  );
  const togglePgAnalyze = useCallback(
    (checked: boolean) => onToggle("pganalyze", checked),
    [onToggle],
  );
  const setupGithub = useCallback(() => onSetup?.("github"), [onSetup]);
  const setupLinear = useCallback(() => onSetup?.("linear"), [onSetup]);
  const setupZendesk = useCallback(() => onSetup?.("zendesk"), [onSetup]);
  const setupPgAnalyze = useCallback(() => onSetup?.("pganalyze"), [onSetup]);

  return (
    <Flex gap="4">
      {/* PostHog data */}
      <Flex direction="column" gap="2" className="min-w-0 flex-1">
        <Text className="font-medium text-(--gray-9) text-[13px]">
          PostHog data
        </Text>
        <Flex direction="column" gap="3">
          <SignalSourceToggleCard
            icon={<BugIcon size={20} />}
            label="Error Tracking"
            description="Surface new issues, reopenings and volume spikes"
            checked={value.error_tracking}
            onCheckedChange={toggleErrorTracking}
            disabled={disabled}
            syncStatus={sourceStates?.error_tracking?.syncStatus}
            docsUrl="https://posthog.com/docs/error-tracking"
            docsLabel="Error Tracking"
          />
          <SignalSourceToggleCard
            icon={<ChatsIcon size={20} />}
            label="Support"
            description="Turn support conversations into signals"
            checked={value.conversations}
            onCheckedChange={toggleConversations}
            disabled={disabled}
            docsUrl="https://posthog.com/docs/support"
            docsLabel="Support"
          />
          <SignalSourceToggleCard
            icon={<VideoIcon size={20} />}
            label="Session Replay"
            labelSuffix={<Badge color="orange">Alpha</Badge>}
            description="Analyze recordings for UX issues"
            checked={value.session_replay}
            onCheckedChange={toggleSessionReplay}
            disabled={disabled}
            docsUrl="https://posthog.com/docs/session-replay"
            docsLabel="Session Replay"
            statusSection={
              value.session_replay ? (
                <SourceRunningIndicator
                  status={sourceStates?.session_replay?.syncStatus ?? null}
                  message="Session analysis run in progress now..."
                />
              ) : undefined
            }
          />
          {evaluationsUrl && (
            <EvaluationsSection evaluationsUrl={evaluationsUrl} />
          )}
        </Flex>
      </Flex>

      {/* External connections */}
      <Flex direction="column" gap="2" className="min-w-0 flex-1">
        <Text className="font-medium text-(--gray-9) text-[13px]">
          External connections
        </Text>
        <Flex direction="column" gap="3">
          <SignalSourceToggleCard
            icon={<GithubLogoIcon size={20} />}
            label="GitHub Issues"
            description="Monitor new issues and updates"
            checked={value.github}
            onCheckedChange={toggleGithub}
            disabled={disabled}
            requiresSetup={sourceStates?.github?.requiresSetup}
            onSetup={setupGithub}
            loading={sourceStates?.github?.loading}
            syncStatus={sourceStates?.github?.syncStatus}
          />
          <SignalSourceToggleCard
            icon={<KanbanIcon size={20} />}
            label="Linear"
            description="Monitor new issues and updates"
            checked={value.linear}
            onCheckedChange={toggleLinear}
            disabled={disabled}
            requiresSetup={sourceStates?.linear?.requiresSetup}
            onSetup={setupLinear}
            loading={sourceStates?.linear?.loading}
            syncStatus={sourceStates?.linear?.syncStatus}
          />
          <SignalSourceToggleCard
            icon={<TicketIcon size={20} />}
            label="Zendesk"
            description="Monitor incoming support tickets"
            checked={value.zendesk}
            onCheckedChange={toggleZendesk}
            disabled={disabled}
            requiresSetup={sourceStates?.zendesk?.requiresSetup}
            onSetup={setupZendesk}
            loading={sourceStates?.zendesk?.loading}
            syncStatus={sourceStates?.zendesk?.syncStatus}
          />
          <SignalSourceToggleCard
            icon={<PgAnalyzeIcon size={20} />}
            label="pganalyze"
            description="Postgres performance findings, slow queries, and index recommendations"
            checked={value.pganalyze}
            onCheckedChange={togglePgAnalyze}
            disabled={disabled}
            requiresSetup={sourceStates?.pganalyze?.requiresSetup}
            onSetup={setupPgAnalyze}
            loading={sourceStates?.pganalyze?.loading}
            syncStatus={sourceStates?.pganalyze?.syncStatus}
          />
        </Flex>
      </Flex>
    </Flex>
  );
}
