import {
  ArrowSquareOutIcon,
  CaretRightIcon,
  LockKeyIcon,
  RobotIcon,
} from "@phosphor-icons/react";
import type {
  AgentAnalyticsAgentRow,
  AgentApplication,
} from "@posthog/shared/agent-platform-types";
import { AgentsTabLayout } from "@posthog/ui/features/agents/components/AgentsTabLayout";
import { Badge } from "@posthog/ui/primitives/Badge";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { Flex, Text } from "@radix-ui/themes";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useAuthStateValue } from "../../auth/store";
import { useAgentAnalytics } from "../hooks/useAgentAnalytics";
import { useAgentApplications } from "../hooks/useAgentApplications";
import { useAgentFleetApprovals } from "../hooks/useAgentFleetApprovals";
import { formatSpendUsd } from "../utils/format";
import { aiObservabilityTracesUrl } from "../utils/observabilityLinks";
import { AgentAnalyticsKpiStrip } from "./AgentAnalyticsView";
import { AgentDetailEmptyState } from "./AgentDetailLayout";
import { AgentFleetLiveSessionsPanel } from "./AgentFleetLiveSessionsPanel";

/**
 * The Applications tab. Renders the deployed-agent fleet as the primary
 * surface, with operational / activity / live-now panels appearing below the
 * list only when they have something to say. A quiet fleet still feels like a
 * launchpad: just the agents, sectioned LIVE vs DRAFTS.
 */
export function AgentApplicationsListView() {
  const region = useAuthStateValue((s) => s.cloudRegion);
  const projectId = useAuthStateValue((s) => s.currentProjectId);

  const {
    data: applications,
    isLoading,
    isError,
    error,
  } = useAgentApplications();
  const { data: analytics, isLoading: analyticsLoading } = useAgentAnalytics();
  const { data: queuedApprovals } = useAgentFleetApprovals({ state: "queued" });
  const aiObservabilityUrl = aiObservabilityTracesUrl(region, projectId);
  const pendingCount = queuedApprovals?.length ?? 0;
  const hasAnalytics = analytics ? !analytics.empty : false;

  // Index the per-agent rollups by application id so each row can show its own
  // sessions / spend / failure rate without a second request.
  const statsById = useMemo(() => {
    const map = new Map<string, AgentAnalyticsAgentRow>();
    for (const row of analytics?.byAgent ?? []) {
      map.set(row.id, row);
    }
    return map;
  }, [analytics]);

  // Split LIVE vs DRAFT so the operational view foregrounds what's serving
  // traffic; drafts dim and section below.
  const { liveApps, draftApps } = useMemo(() => {
    const live: AgentApplication[] = [];
    const draft: AgentApplication[] = [];
    for (const app of applications ?? []) {
      if (app.live_revision != null) live.push(app);
      else draft.push(app);
    }
    return { liveApps: live, draftApps: draft };
  }, [applications]);

  return (
    <AgentsTabLayout activeTab="applications">
      <Flex direction="column" gap="6">
        <section>
          {isLoading ? (
            <ApplicationsSkeleton />
          ) : isError ? (
            <AgentDetailEmptyState
              title="Couldn't load applications"
              description={
                error instanceof Error
                  ? error.message
                  : "The agent platform API returned an error."
              }
            />
          ) : !applications || applications.length === 0 ? (
            <AgentDetailEmptyState
              title="No agents yet"
              description="Deployed agents on the agent platform will show up here."
            />
          ) : (
            <Flex direction="column" gap="5">
              <AgentsSection
                label="Live"
                apps={liveApps}
                statsById={statsById}
              />
              {draftApps.length > 0 ? (
                <AgentsSection
                  label="Drafts"
                  apps={draftApps}
                  statsById={statsById}
                  dimmed
                />
              ) : null}
            </Flex>
          )}
        </section>

        <OperationalStrip pendingCount={pendingCount} />

        {hasAnalytics ? (
          <section>
            <Flex align="center" justify="between" className="mb-3">
              <Text className="font-semibold text-[13px] text-gray-12">
                Activity · last 7 days
              </Text>
              {aiObservabilityUrl ? (
                <button
                  type="button"
                  onClick={() => openExternalUrl(aiObservabilityUrl)}
                  className="inline-flex items-center gap-1 text-[12px] text-gray-11 no-underline hover:text-gray-12"
                >
                  Open in AI observability
                  <ArrowSquareOutIcon size={12} />
                </button>
              ) : null}
            </Flex>
            <AgentAnalyticsKpiStrip
              data={analytics}
              isLoading={analyticsLoading}
            />
          </section>
        ) : null}

        <AgentFleetLiveSessionsPanel />
      </Flex>
    </AgentsTabLayout>
  );
}

/** A labeled group of agent rows; `dimmed` softens drafts so live agents
 * dominate the visual hierarchy. */
function AgentsSection({
  label,
  apps,
  statsById,
  dimmed,
}: {
  label: string;
  apps: AgentApplication[];
  statsById: Map<string, AgentAnalyticsAgentRow>;
  dimmed?: boolean;
}) {
  if (apps.length === 0) return null;
  return (
    <Flex direction="column" gap="2">
      <Flex align="center" gap="2">
        <Text className="text-[11px] text-gray-10 uppercase tracking-wide">
          {label}
        </Text>
        <Text className="text-[11px] text-gray-9 tabular-nums">
          {apps.length}
        </Text>
      </Flex>
      <div className={dimmed ? "opacity-70" : undefined}>
        <Flex direction="column" gap="2">
          {apps.map((app) => (
            <ApplicationRow
              key={app.id}
              application={app}
              stats={statsById.get(app.id)}
            />
          ))}
        </Flex>
      </div>
    </Flex>
  );
}

function ApplicationRow({
  application,
  stats,
}: {
  application: AgentApplication;
  stats?: AgentAnalyticsAgentRow;
}) {
  const isLive = application.live_revision != null;
  return (
    <Link
      to="/code/agents/applications/$idOrSlug"
      params={{ idOrSlug: application.slug ?? application.id }}
      className="flex items-center justify-between gap-3 rounded-(--radius-2) border border-border bg-(--color-panel-solid) px-4 py-3.5 no-underline transition-colors duration-150 hover:border-(--gray-6) hover:bg-(--gray-2)"
    >
      <Flex align="center" gap="3" className="min-w-0">
        <RobotIcon size={20} className="shrink-0 text-gray-11" />
        <Flex direction="column" gap="0.5" className="min-w-0">
          <Flex align="center" gap="2" className="min-w-0">
            <Text className="truncate font-medium text-[13px] text-gray-12">
              {application.name}
            </Text>
            <Badge color={isLive ? "green" : "gray"}>
              {isLive ? "Live" : "Draft"}
            </Badge>
          </Flex>
          <Text className="truncate text-[12px] text-gray-11 leading-snug">
            {application.description?.trim()
              ? application.description
              : (application.slug ?? application.id)}
          </Text>
        </Flex>
      </Flex>
      <Flex align="center" gap="4" className="shrink-0">
        {stats ? <RowStats stats={stats} /> : null}
        <CaretRightIcon size={14} className="shrink-0 text-gray-10" />
      </Flex>
    </Link>
  );
}

/** Inline 7-day rollups shown on an agent row, joined from the fleet query. */
function RowStats({ stats }: { stats: AgentAnalyticsAgentRow }) {
  return (
    <Flex align="center" gap="4" className="hidden sm:flex">
      <RowStat label="Sessions" value={stats.sessions.toLocaleString()} />
      <RowStat label="Spend" value={formatSpendUsd(stats.spendUsd)} />
      <RowStat
        label="Fail rate"
        value={`${(stats.failureRate * 100).toFixed(1)}%`}
        attention={stats.failureRate > 0}
      />
    </Flex>
  );
}

function RowStat({
  label,
  value,
  attention,
}: {
  label: string;
  value: string;
  attention?: boolean;
}) {
  return (
    <Flex direction="column" align="end" gap="0.5" className="shrink-0">
      <Text
        className={`font-medium text-[12px] tabular-nums ${
          attention ? "text-(--red-11)" : "text-gray-12"
        }`}
      >
        {value}
      </Text>
      <Text className="text-[10px] text-gray-10 uppercase tracking-wide">
        {label}
      </Text>
    </Flex>
  );
}

/**
 * Operational counts strip — always renders the pending-approvals count as a
 * deep link to the fleet approvals queue, and visually emphasizes the row when
 * `pendingCount > 0`.
 */
function OperationalStrip({ pendingCount }: { pendingCount: number }) {
  const pendingAttention = pendingCount > 0;
  return (
    <Flex align="center" gap="5" className="text-[12.5px]">
      <Link
        to="/code/agents/applications/approvals"
        className="inline-flex items-center gap-1 text-gray-11 no-underline hover:text-gray-12"
      >
        <LockKeyIcon
          size={13}
          className={`mr-1 ${pendingAttention ? "text-(--amber-11)" : "text-gray-10"}`}
        />
        <Text
          className={`font-medium tabular-nums ${pendingAttention ? "text-(--amber-11)" : "text-gray-12"}`}
        >
          {pendingCount}
        </Text>
        <Text>pending approval{pendingCount === 1 ? "" : "s"}</Text>
        <CaretRightIcon size={11} className="text-gray-10" />
      </Link>
    </Flex>
  );
}

function ApplicationsSkeleton() {
  return (
    <Flex direction="column" gap="2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-[58px] animate-pulse rounded-(--radius-2) border border-border bg-(--gray-2)"
        />
      ))}
    </Flex>
  );
}
