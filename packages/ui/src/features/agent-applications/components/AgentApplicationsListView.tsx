import {
  ArrowSquareOutIcon,
  BroadcastIcon,
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
import { useAgentFleetLiveSessions } from "../hooks/useAgentFleetLiveSessions";
import { formatSpendUsd } from "../utils/format";
import { aiObservabilityTracesUrl } from "../utils/observabilityLinks";
import { AgentAnalyticsKpiStrip } from "./AgentAnalyticsView";
import { AgentDetailEmptyState } from "./AgentDetailLayout";
import { AgentFleetLiveSessionsPanel } from "./AgentFleetLiveSessionsPanel";

/**
 * The Applications tab: the fleet observability KPIs (spend / sessions /
 * failure rate / p95 over the team's `$ai_*` events) blended on top of the list
 * of deployed agents. The per-agent rollups from the same analytics query are
 * merged into each list row as inline stats, so one fetch powers both the KPI
 * strip and the rows. Each row links to the per-agent detail view.
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
  const { data: liveSessions } = useAgentFleetLiveSessions();
  const { data: queuedApprovals } = useAgentFleetApprovals({ state: "queued" });
  const aiObservabilityUrl = aiObservabilityTracesUrl(region, projectId);
  const liveCount = liveSessions?.results.length ?? 0;
  const pendingCount = queuedApprovals?.length ?? 0;

  // Index the per-agent rollups by application id so each row can show its own
  // sessions / spend / failure rate without a second request.
  const statsById = useMemo(() => {
    const map = new Map<string, AgentAnalyticsAgentRow>();
    for (const row of analytics?.byAgent ?? []) {
      map.set(row.id, row);
    }
    return map;
  }, [analytics]);

  return (
    <AgentsTabLayout activeTab="applications">
      <Flex direction="column" gap="5">
        <OperationalStrip liveCount={liveCount} pendingCount={pendingCount} />

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

        <AgentFleetLiveSessionsPanel />

        <Flex direction="column" gap="2">
          <Text className="text-[11px] text-gray-10 uppercase tracking-wide">
            Agents
          </Text>
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
            applications.map((app) => (
              <ApplicationRow
                key={app.id}
                application={app}
                stats={statsById.get(app.id)}
              />
            ))
          )}
        </Flex>
      </Flex>
    </AgentsTabLayout>
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
 * Operational counts strip — restores the "live now / pending approvals"
 * signals the M7 analytics KPIs displaced. Live count anchors the live-now
 * panel below; pending links to the fleet approvals queue.
 */
function OperationalStrip({
  liveCount,
  pendingCount,
}: {
  liveCount: number;
  pendingCount: number;
}) {
  return (
    <Flex align="center" gap="5" className="text-[12.5px]">
      <Flex align="center" gap="1.5" className="text-gray-11">
        <BroadcastIcon size={13} className="text-gray-10" />
        <Text className="font-medium text-gray-12 tabular-nums">
          {liveCount}
        </Text>
        <Text>live now</Text>
      </Flex>
      <Link
        to="/code/agents/applications/approvals"
        className="inline-flex items-center gap-1.5 text-gray-11 no-underline hover:text-gray-12"
      >
        <LockKeyIcon size={13} className="text-gray-10" />
        <Text
          className={`font-medium tabular-nums ${pendingCount > 0 ? "text-(--amber-11)" : "text-gray-12"}`}
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
