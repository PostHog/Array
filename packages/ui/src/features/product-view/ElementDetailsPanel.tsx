import {
  ArrowSquareOutIcon,
  PulseIcon,
  UsersIcon,
  WarningIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useHostTRPC } from "@posthog/host-router/react";
import { Badge, Button, Spinner } from "@posthog/quill";
import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import {
  errorTrackingIssueUrl,
  replayUrl,
} from "@posthog/ui/utils/posthogLinks";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { SelectedElement } from "./useSelectedElement";

const compact = (value: number): string =>
  Intl.NumberFormat("en", { notation: "compact" }).format(value);

function Section(props: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-semibold text-[11px] text-gray-10 uppercase tracking-wide">
        {props.title}
      </span>
      {props.children}
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <span className="text-gray-10 text-xs">{text}</span>;
}

/** Tiny dependency-free daily-usage sparkline (30 bars max). */
function TrendBars(props: { trend: { day: string; clicks: number }[] }) {
  const max = Math.max(...props.trend.map((t) => t.clicks), 1);
  return (
    <div className="flex h-12 items-end gap-px" aria-label="Daily clicks">
      {props.trend.map((point) => (
        <div
          key={point.day}
          title={`${point.day.slice(0, 10)}: ${point.clicks} clicks`}
          className="min-w-1 flex-1 rounded-t-xs bg-blue-9"
          style={{ height: `${Math.max(6, (point.clicks / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * The full story for one selected element: usage, frustration, errors,
 * latency, network trace, and example sessions — everything the host resolved
 * from the environment's data project, rendered beside the live page.
 */
export function ElementDetailsPanel(props: {
  viewId: string;
  selected: SelectedElement;
  dataProjectId: number;
  onClose: () => void;
  investigateSlot?: ReactNode;
}) {
  const { viewId, selected, dataProjectId, onClose } = props;
  const trpc = useHostTRPC();
  const { data: detail, isLoading } = useQuery(
    trpc.productView.getElementDetail.queryOptions({
      viewId,
      pageUrl: selected.pageUrl,
      element: selected.element,
    }),
  );

  const element = selected.element;
  const title =
    element.text || element.dataAttr || element.id || `<${element.tag}>`;
  const linkOverrides = { projectId: dataProjectId };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col overflow-y-auto border-gray-4 border-l">
      <div className="flex items-start justify-between gap-2 border-gray-4 border-b p-3">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="truncate font-semibold text-gray-12 text-sm">
            {title}
          </span>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="default">{element.tag}</Badge>
            {element.dataAttr && (
              <Badge variant="info" title="data-attr">
                {element.dataAttr}
              </Badge>
            )}
          </div>
        </div>
        <Button size="icon-sm" aria-label="Close details" onClick={onClose}>
          <XIcon size={14} />
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-3">
        {isLoading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {detail && (
          <>
            <Section title="Usage · 30d">
              {detail.trend.length === 0 ? (
                <EmptyLine text="No autocapture interactions matched this element." />
              ) : (
                <>
                  <TrendBars trend={detail.trend} />
                  <div className="flex gap-3 text-gray-11 text-xs">
                    <span className="flex items-center gap-1">
                      <PulseIcon size={12} />
                      {compact(
                        detail.trend.reduce((sum, t) => sum + t.clicks, 0),
                      )}{" "}
                      clicks
                    </span>
                    <span className="flex items-center gap-1">
                      <UsersIcon size={12} />
                      {compact(
                        Math.max(...detail.trend.map((t) => t.users), 0),
                      )}{" "}
                      users/day peak
                    </span>
                  </div>
                </>
              )}
              {detail.totals &&
                detail.totals.rageclicks + detail.totals.deadclicks > 0 && (
                  <span className="flex items-center gap-1 text-amber-11 text-xs">
                    <WarningIcon size={12} />
                    {compact(detail.totals.rageclicks)} rage ·{" "}
                    {compact(detail.totals.deadclicks)} dead clicks (7d)
                  </span>
                )}
            </Section>

            <Section title="Errors in sessions using this">
              {detail.errors.length === 0 ? (
                <EmptyLine text="No exceptions in sessions that used this element." />
              ) : (
                detail.errors.map((issue) => {
                  const url = errorTrackingIssueUrl(
                    issue.issueId,
                    linkOverrides,
                  );
                  return (
                    <button
                      type="button"
                      key={issue.issueId}
                      className="flex items-center justify-between gap-2 rounded border border-gray-4 px-2 py-1.5 text-left text-xs hover:bg-gray-3"
                      onClick={() => url && openExternalUrl(url)}
                    >
                      <span className="min-w-0 truncate text-gray-12">
                        {issue.types[0] ?? "Error"}
                        <span className="ml-1 text-gray-10">
                          {issue.issueId.slice(0, 8)}
                        </span>
                      </span>
                      <span className="shrink-0 text-gray-11">
                        {compact(issue.occurrences)}× ·{" "}
                        {compact(issue.affectedUsers)} users
                      </span>
                    </button>
                  );
                })
              )}
            </Section>

            <Section title="Latency">
              {detail.liveLatency ? (
                <div className="flex gap-3 font-mono text-gray-12 text-xs">
                  <span>p50 {Math.round(detail.liveLatency.p50)}ms</span>
                  <span>p95 {Math.round(detail.liveLatency.p95)}ms</span>
                  <span>p99 {Math.round(detail.liveLatency.p99)}ms</span>
                  <span className="text-gray-10">
                    ({detail.liveLatency.count} live reqs)
                  </span>
                </div>
              ) : (
                <EmptyLine text="Interact with the element to sample its requests live." />
              )}
              {detail.vitals && (
                <span className="text-gray-11 text-xs">
                  Page p75: INP {Math.round(detail.vitals.inpP75)}ms · LCP{" "}
                  {Math.round(detail.vitals.lcpP75)}ms
                </span>
              )}
            </Section>

            <Section title="Network trace">
              {detail.recentRequests.length === 0 ? (
                <EmptyLine text="No requests captured yet — click around the page." />
              ) : (
                detail.recentRequests
                  .slice(-8)
                  .reverse()
                  .map((request) => (
                    <div
                      key={`${request.timestamp}-${request.url}`}
                      className="flex items-center justify-between gap-2 font-mono text-[11px]"
                    >
                      <span className="min-w-0 truncate text-gray-11">
                        {request.method}{" "}
                        {request.url.replace(/^https?:\/\/[^/]+/, "")}
                      </span>
                      <span className="shrink-0 text-gray-10">
                        {request.status ?? "…"}
                        {request.durationMs != null &&
                          ` · ${request.durationMs}ms`}
                        {request.traceId && " · trace"}
                      </span>
                    </div>
                  ))
              )}
            </Section>

            <Section title="Sessions">
              {detail.sessions.length === 0 ? (
                <EmptyLine text="No recent sessions matched." />
              ) : (
                detail.sessions.map((session) => {
                  const url = replayUrl(session.sessionId, linkOverrides);
                  return (
                    <button
                      type="button"
                      key={session.sessionId}
                      className="flex items-center justify-between gap-2 rounded border border-gray-4 px-2 py-1.5 text-left text-xs hover:bg-gray-3"
                      onClick={() => url && openExternalUrl(url)}
                    >
                      <span className="truncate font-mono text-gray-11">
                        {session.sessionId.slice(0, 18)}…
                      </span>
                      <ArrowSquareOutIcon size={12} className="shrink-0" />
                    </button>
                  );
                })
              )}
            </Section>

            {props.investigateSlot}
          </>
        )}
      </div>
    </div>
  );
}
