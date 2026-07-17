// Category STARTER dashboards for a workflow's metrics canvas. Instead of the
// agent authoring the whole React app from scratch (slow), the workflow
// generation prompt seeds the scaffold matching the workflow's category, and the
// agent just replaces the placeholder metrics with SAVED insights it discovers.
//
// The two categories mirror the adaptive rules in canvasTemplates
// (FREEFORM_WORKFLOW_RULES):
//   - health:     alert / notification / sync / data-hygiene → deliverability
//   - engagement: marketing / lifecycle email → send→open→click
//
// Both reuse the EXACT proven wiring from FREEFORM_STARTER_CODE (self-sizing date
// picker, theme tokens, per-card skeletons, typed-node result reading) so they
// compile as-is. The sample query is "all events" (works on any project) — the
// agent swaps each metric for a real SAVED insight loaded with
// `ph.loadInsight(shortId, { dateRange })`, and renders the not-yet-fired empty
// state when there's no data (never zeros-as-failures).

// Shared prelude (imports + date/refresh/loading state) so the two starters stay
// in lockstep with the base scaffold's wiring.
const STARTER_PRELUDE = `import React, { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DateTimePicker,
  Heading,
  Popover,
  PopoverContent,
  PopoverTrigger,
  quickRanges,
  SkeletonText,
  Text,
} from "@posthog/quill";
import { RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";`;

// Deliverability & health board: successful vs failed deliveries, success rate,
// error/last-fired KPIs. For alert / notification / sync / data-hygiene flows.
export const WORKFLOW_HEALTH_STARTER = `${STARTER_PRELUDE}

// STARTER: workflow deliverability & health board. KEEP the wiring; REPLACE
// the placeholder "all events" query with SAVED insights for this workflow's
// real delivery + failure metrics (discover the event/table names via MCP).
export default function Canvas() {
  const def =
    quickRanges.find((r) => r.name === "Last 30 days") ?? quickRanges[0];
  const [win, setWin] = useState({
    start: def.rangeSetter(new Date()),
    end: new Date(),
    range: def,
  });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // TODO(agent): replace with the workflow's real delivery metrics — one SAVED
  // insight per KPI, loaded via ph.loadInsight(shortId, { dateRange }). Keep the
  // shape: a per-day series for the chart and totals for the KPI cards.
  const [delivered, setDelivered] = useState(0);
  const [failed, setFailed] = useState(0);
  const [series, setSeries] = useState([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ph.query({
      kind: "TrendsQuery",
      series: [
        { kind: "EventsNode", event: null, name: "All events", math: "total" },
      ],
      dateRange: {
        date_from: win.start.toISOString(),
        date_to: win.end.toISOString(),
      },
    })
      .then((res) => {
        if (cancelled) return;
        const s = res.results[0] ?? {};
        setDelivered(s.count ?? 0);
        setFailed(0); // TODO(agent): a second insight for failed deliveries.
        setSeries(
          (s.days ?? []).map((day, i) => ({
            day,
            delivered: s.data?.[i] ?? 0,
            failed: 0,
          })),
        );
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [win, nonce]);

  const total = delivered + failed;
  const successRate = total > 0 ? Math.round((delivered / total) * 100) : 0;
  const hasData = loading || total > 0;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <Heading size="xl">Deliverability & health</Heading>
        <div className="flex items-center gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={<Button variant="outline">{win.range.name}</Button>}
            />
            <PopoverContent className="w-auto p-0">
              <DateTimePicker
                value={win}
                onApply={(v) => {
                  setWin(v);
                  setOpen(false);
                }}
                onCancel={() => setOpen(false)}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setNonce((n) => n + 1)}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      </div>

      {!hasData ? (
        // Not-yet-fired: no deliveries in this window — say so, don't show zeros
        // as failures.
        <Card size="sm">
          <CardContent>
            <div className="flex flex-col items-center gap-1 py-16 text-center">
              <Heading size="base">This workflow hasn't fired yet</Heading>
              <Text className="text-muted-foreground">
                Delivery volume, success rate, and history will appear here once
                the workflow is live and starts running.
              </Text>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Delivered</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <SkeletonText lines={1} className="text-3xl" />
                ) : (
                  <Heading size="2xl">{delivered.toLocaleString()}</Heading>
                )}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>Success rate</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <SkeletonText lines={1} className="text-3xl" />
                ) : (
                  <div className="flex items-center gap-2">
                    <Heading size="2xl">{successRate}%</Heading>
                    <Badge variant={failed > 0 ? "warning" : "success"}>
                      {failed.toLocaleString()} failed
                    </Badge>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>Failures</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <SkeletonText lines={1} className="text-3xl" />
                ) : (
                  <Heading size="2xl">{failed.toLocaleString()}</Heading>
                )}
              </CardContent>
            </Card>
          </div>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Deliveries over time</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <SkeletonText lines={6} />
              ) : (
                <div className="h-[280px] w-full">
                  <ResponsiveContainer>
                    <LineChart data={series}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="day"
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="delivered"
                        stroke="var(--primary)"
                        dot={false}
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="failed"
                        stroke="var(--destructive-foreground)"
                        dot={false}
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}`;

// Engagement board: sends/opens/clicks/bounces + a send→open→click funnel. For
// marketing / lifecycle email flows.
export const WORKFLOW_ENGAGEMENT_STARTER = `${STARTER_PRELUDE}

// STARTER: workflow email-engagement board. KEEP the wiring; REPLACE the
// placeholder "all events" query with SAVED insights for this workflow's real
// send / open / click / bounce metrics (discover the event names via MCP).
export default function Canvas() {
  const def =
    quickRanges.find((r) => r.name === "Last 30 days") ?? quickRanges[0];
  const [win, setWin] = useState({
    start: def.rangeSetter(new Date()),
    end: new Date(),
    range: def,
  });
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // TODO(agent): replace with the workflow's real email metrics — one SAVED
  // insight per stage, loaded via ph.loadInsight(shortId, { dateRange }).
  const [sends, setSends] = useState(0);
  const [opens, setOpens] = useState(0);
  const [clicks, setClicks] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ph.query({
      kind: "TrendsQuery",
      series: [
        { kind: "EventsNode", event: null, name: "All events", math: "total" },
      ],
      dateRange: {
        date_from: win.start.toISOString(),
        date_to: win.end.toISOString(),
      },
    })
      .then((res) => {
        if (cancelled) return;
        const s = res.results[0] ?? {};
        const n = s.count ?? 0;
        // TODO(agent): these are placeholders derived from one series so the
        // funnel renders — replace each with its own saved insight.
        setSends(n);
        setOpens(Math.round(n * 0.4));
        setClicks(Math.round(n * 0.1));
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [win, nonce]);

  const openRate = sends > 0 ? Math.round((opens / sends) * 100) : 0;
  const clickRate = sends > 0 ? Math.round((clicks / sends) * 100) : 0;
  const funnel = [
    { stage: "Sent", value: sends },
    { stage: "Opened", value: opens },
    { stage: "Clicked", value: clicks },
  ];
  const hasData = loading || sends > 0;

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <Heading size="xl">Email engagement</Heading>
        <div className="flex items-center gap-2">
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger
              render={<Button variant="outline">{win.range.name}</Button>}
            />
            <PopoverContent className="w-auto p-0">
              <DateTimePicker
                value={win}
                onApply={(v) => {
                  setWin(v);
                  setOpen(false);
                }}
                onCancel={() => setOpen(false)}
              />
            </PopoverContent>
          </Popover>
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => setNonce((n) => n + 1)}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
            Refresh
          </Button>
        </div>
      </div>

      {!hasData ? (
        <Card size="sm">
          <CardContent>
            <div className="flex flex-col items-center gap-1 py-16 text-center">
              <Heading size="base">This workflow hasn't sent yet</Heading>
              <Text className="text-muted-foreground">
                Sends, opens, clicks, and the engagement funnel will appear here
                once the workflow is live.
              </Text>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card size="sm">
              <CardHeader>
                <CardTitle>Sent</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <SkeletonText lines={1} className="text-3xl" />
                ) : (
                  <Heading size="2xl">{sends.toLocaleString()}</Heading>
                )}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>Open rate</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <SkeletonText lines={1} className="text-3xl" />
                ) : (
                  <Heading size="2xl">{openRate}%</Heading>
                )}
              </CardContent>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardTitle>Click rate</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <SkeletonText lines={1} className="text-3xl" />
                ) : (
                  <Heading size="2xl">{clickRate}%</Heading>
                )}
              </CardContent>
            </Card>
          </div>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Send → open → click</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <SkeletonText lines={6} />
              ) : (
                <div className="h-[280px] w-full">
                  <ResponsiveContainer>
                    <BarChart data={funnel}>
                      <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="stage"
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 12 }}
                      />
                      <YAxis
                        stroke="var(--muted-foreground)"
                        tick={{ fontSize: 12 }}
                      />
                      <Tooltip />
                      <Bar dataKey="value" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}`;
