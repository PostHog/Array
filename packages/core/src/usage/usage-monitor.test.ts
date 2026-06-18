import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageHost } from "./identifiers";
import { UsageMonitorEvent } from "./monitor-schemas";
import type { UsageOutput } from "./schemas";
import { UsageMonitorService } from "./usage-monitor";

type ActivitySlice = Pick<
  UsageHost,
  "onLlmActivity" | "offLlmActivity" | "hasActiveSessions"
>;

interface MockActivityMonitor extends ActivitySlice {
  fireLlmActivity(): void;
}

function makeActivityMonitor(opts?: {
  hasActiveSessions?: boolean;
}): MockActivityMonitor {
  const listeners = new Set<() => void>();
  return {
    onLlmActivity: (l) => listeners.add(l),
    offLlmActivity: (l) => listeners.delete(l),
    hasActiveSessions: () => opts?.hasActiveSessions ?? false,
    fireLlmActivity: () => {
      for (const l of [...listeners]) l();
    },
  };
}

type ThresholdSlice = Pick<
  UsageHost,
  "getThresholdsSeen" | "setThresholdsSeen"
>;

let persisted: Record<string, string> = {};

function makeThresholdStore(): ThresholdSlice {
  return {
    getThresholdsSeen: () => ({ ...persisted }),
    setThresholdsSeen: (v) => {
      persisted = { ...v };
    },
  };
}

function makeLogger() {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { ...log, scope: () => log };
}

type GatewaySlice = Pick<UsageHost, "fetchUsage">;

function makeService(
  gateway: GatewaySlice,
  activity: ActivitySlice,
): UsageMonitorService {
  const host: UsageHost = {
    ...gateway,
    ...activity,
    ...makeThresholdStore(),
  };
  return new UsageMonitorService(host, makeLogger());
}

function makeUsage(overrides?: {
  burstPercent?: number;
  sustainedPercent?: number;
  billingPeriodEnd?: string | null;
  burstResetAt?: string;
  sustainedResetAt?: string;
  isPro?: boolean;
}): UsageOutput {
  return {
    product: "posthog_code",
    user_id: 42,
    is_rate_limited: false,
    is_pro: overrides?.isPro ?? false,
    billing_period_end:
      overrides?.billingPeriodEnd === undefined
        ? null
        : overrides.billingPeriodEnd,
    burst: {
      used_percent: overrides?.burstPercent ?? 0,
      reset_at: overrides?.burstResetAt ?? "2026-05-25T16:00:00.000Z",
      exceeded: false,
    },
    sustained: {
      used_percent: overrides?.sustainedPercent ?? 0,
      reset_at: overrides?.sustainedResetAt ?? "2026-06-01T00:00:00.000Z",
      exceeded: false,
    },
  };
}

function mockGateway(usage: UsageOutput | null): GatewaySlice {
  return {
    fetchUsage: vi.fn().mockResolvedValue(usage),
  } as unknown as GatewaySlice;
}

describe("UsageMonitorService", () => {
  let service: UsageMonitorService;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
    persisted = {};
  });

  afterEach(() => {
    service?.stop();
    vi.useRealTimers();
  });

  it("emits at 75% but not again on the next poll for the same anchor", async () => {
    const events: unknown[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 78 }));
    service = makeService(gateway, makeActivityMonitor());
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));

    await service.fetchOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      bucket: "burst",
      threshold: 75,
      usedPercent: 78,
    });

    await service.fetchOnce();
    expect(events).toHaveLength(1);
  });

  it("only emits the highest threshold a bucket has crossed", async () => {
    const events: unknown[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 95 }));
    service = makeService(gateway, makeActivityMonitor());
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));

    await service.fetchOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ threshold: 90 });
  });

  it("doesn't re-emit after a relaunch with persisted dedupe", async () => {
    const events: unknown[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 55 }));
    service = makeService(gateway, makeActivityMonitor());
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));
    await service.fetchOnce();
    expect(events).toHaveLength(1);
    service.stop();

    service = makeService(gateway, makeActivityMonitor());
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));
    await service.fetchOnce();
    expect(events).toHaveLength(1);
  });

  it("tracks burst and sustained as independent buckets", async () => {
    const events: unknown[] = [];
    const gateway = mockGateway(
      makeUsage({
        burstPercent: 55,
        sustainedPercent: 80,
        billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      }),
    );
    service = makeService(gateway, makeActivityMonitor());
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));

    await service.fetchOnce();
    expect(events).toHaveLength(2);
    expect(events.map((e) => (e as { bucket: string }).bucket).sort()).toEqual([
      "burst",
      "sustained",
    ]);
  });

  it("marks events with isPro from the gateway", async () => {
    const events: { isPro: boolean }[] = [];
    const gateway = mockGateway(
      makeUsage({
        sustainedPercent: 60,
        isPro: true,
        billingPeriodEnd: "2026-06-01T00:00:00.000Z",
      }),
    );
    service = makeService(gateway, makeActivityMonitor());
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) =>
      events.push(e as { isPro: boolean }),
    );

    await service.fetchOnce();
    expect(events[0]?.isPro).toBe(true);
  });

  it("marks events with userIsActive from the agent service", async () => {
    const events: { userIsActive: boolean }[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 78 }));
    service = makeService(
      gateway,
      makeActivityMonitor({ hasActiveSessions: true }),
    );
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) =>
      events.push(e as { userIsActive: boolean }),
    );

    await service.fetchOnce();
    expect(events[0]?.userIsActive).toBe(true);
  });

  it("silently skips polls when the gateway throws", async () => {
    const events: unknown[] = [];
    const gateway = {
      fetchUsage: vi.fn().mockRejectedValue(new Error("not authenticated")),
    } as unknown as GatewaySlice;
    service = makeService(gateway, makeActivityMonitor());
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));

    await expect(service.fetchOnce()).resolves.toBeNull();
    expect(events).toHaveLength(0);
  });

  it("emits UsageUpdated only when the snapshot actually changes", async () => {
    const updates: UsageOutput[] = [];
    const gateway = {
      fetchUsage: vi
        .fn()
        .mockResolvedValueOnce(makeUsage({ burstPercent: 20 }))
        .mockResolvedValueOnce(makeUsage({ burstPercent: 20 }))
        .mockResolvedValueOnce(makeUsage({ burstPercent: 35 })),
    } as unknown as GatewaySlice;
    service = makeService(gateway, makeActivityMonitor());
    service.on(UsageMonitorEvent.UsageUpdated, (u) => updates.push(u));

    expect(service.getLatest()).toBeNull();
    await service.fetchOnce();
    expect(updates).toHaveLength(1);
    expect(service.getLatest()?.burst.used_percent).toBe(20);

    await service.fetchOnce();
    expect(updates).toHaveLength(1);

    await service.fetchOnce();
    expect(updates).toHaveLength(2);
    expect(updates[1].burst.used_percent).toBe(35);
  });

  it("does not emit UsageUpdated when the gateway throws", async () => {
    const updates: UsageOutput[] = [];
    const gateway = {
      fetchUsage: vi.fn().mockRejectedValue(new Error("offline")),
    } as unknown as GatewaySlice;
    service = makeService(gateway, makeActivityMonitor());
    service.on(UsageMonitorEvent.UsageUpdated, (u) => updates.push(u));

    await service.fetchOnce();
    expect(updates).toHaveLength(0);
    expect(service.getLatest()).toBeNull();
  });

  it("refreshNow triggers a fresh fetch and returns the snapshot", async () => {
    const gateway = mockGateway(makeUsage({ burstPercent: 42 }));
    service = makeService(gateway, makeActivityMonitor());

    const result = await service.refreshNow();
    expect(result?.burst.used_percent).toBe(42);
    expect(service.getLatest()?.burst.used_percent).toBe(42);
  });

  it("collapses bursts of LlmActivity into at most one trailing fetch", async () => {
    const gateway = mockGateway(makeUsage({ burstPercent: 10 }));
    const agent = makeActivityMonitor();
    service = makeService(gateway, agent);
    service.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(gateway.fetchUsage).toHaveBeenCalledTimes(1);

    agent.fireLlmActivity();
    agent.fireLlmActivity();
    agent.fireLlmActivity();
    agent.fireLlmActivity();
    await vi.advanceTimersByTimeAsync(0);
    expect(gateway.fetchUsage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(gateway.fetchUsage).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    agent.fireLlmActivity();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(gateway.fetchUsage).toHaveBeenCalledTimes(3);
  });

  it("unsubscribes from agent events on stop()", async () => {
    const gateway = mockGateway(makeUsage({ burstPercent: 10 }));
    const agent = makeActivityMonitor();
    service = makeService(gateway, agent);
    service.init();
    await vi.advanceTimersByTimeAsync(0);
    const baseline = (gateway.fetchUsage as ReturnType<typeof vi.fn>).mock.calls
      .length;

    service.stop();
    agent.fireLlmActivity();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gateway.fetchUsage).toHaveBeenCalledTimes(baseline);
  });
});
