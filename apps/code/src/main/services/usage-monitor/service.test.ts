import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageOutput } from "../llm-gateway/schemas";
import { UsageMonitorEvent } from "./schemas";

const mockStoreGet = vi.hoisted(() => vi.fn());
const mockStoreSet = vi.hoisted(() => vi.fn());

vi.mock("./store", () => ({
  usageMonitorStore: {
    get: mockStoreGet,
    set: mockStoreSet,
  },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import { AgentServiceEvent } from "../agent/schemas";
import type { AgentService } from "../agent/service";
import type { LlmGatewayService } from "../llm-gateway/service";
import { UsageMonitorService } from "./service";

function makeAgentService(opts?: { hasActiveSessions?: boolean }) {
  const emitter = new TypedEventEmitter<{
    [AgentServiceEvent.LlmActivity]: undefined;
  }>() as unknown as AgentService & { hasActiveSessions: () => boolean };
  emitter.hasActiveSessions = () => opts?.hasActiveSessions ?? false;
  return emitter;
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

function mockGateway(usage: UsageOutput | null): LlmGatewayService {
  return {
    fetchUsage: vi.fn().mockResolvedValue(usage),
  } as unknown as LlmGatewayService;
}

describe("UsageMonitorService", () => {
  let service: UsageMonitorService;
  let persisted: Record<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-25T12:00:00.000Z"));
    persisted = {};
    mockStoreGet.mockImplementation((_key: string, fallback: unknown) => ({
      ...persisted,
      ...(fallback as Record<string, string>),
    }));
    mockStoreSet.mockImplementation(
      (_key: string, value: Record<string, string>) => {
        persisted = { ...value };
      },
    );
  });

  afterEach(() => {
    service?.stop();
    vi.useRealTimers();
  });

  it("emits at 75% but not again on the next poll for the same anchor", async () => {
    const events: unknown[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 78 }));
    service = new UsageMonitorService(gateway, makeAgentService());
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
    service = new UsageMonitorService(gateway, makeAgentService());
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));

    await service.fetchOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ threshold: 90 });
  });

  it("doesn't re-emit after a relaunch with persisted dedupe", async () => {
    const events: unknown[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 55 }));
    service = new UsageMonitorService(gateway, makeAgentService());
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) => events.push(e));
    await service.fetchOnce();
    expect(events).toHaveLength(1);
    service.stop();

    service = new UsageMonitorService(gateway, makeAgentService());
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
    service = new UsageMonitorService(gateway, makeAgentService());
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
    service = new UsageMonitorService(gateway, makeAgentService());
    service.on(UsageMonitorEvent.ThresholdCrossed, (e) =>
      events.push(e as { isPro: boolean }),
    );

    await service.fetchOnce();
    expect(events[0]?.isPro).toBe(true);
  });

  it("marks events with userIsActive from the agent service", async () => {
    const events: { userIsActive: boolean }[] = [];
    const gateway = mockGateway(makeUsage({ burstPercent: 78 }));
    service = new UsageMonitorService(
      gateway,
      makeAgentService({ hasActiveSessions: true }),
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
    } as unknown as LlmGatewayService;
    service = new UsageMonitorService(gateway, makeAgentService());
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
    } as unknown as LlmGatewayService;
    service = new UsageMonitorService(gateway, makeAgentService());
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
    } as unknown as LlmGatewayService;
    service = new UsageMonitorService(gateway, makeAgentService());
    service.on(UsageMonitorEvent.UsageUpdated, (u) => updates.push(u));

    await service.fetchOnce();
    expect(updates).toHaveLength(0);
    expect(service.getLatest()).toBeNull();
  });

  it("refreshNow triggers a fresh fetch and returns the snapshot", async () => {
    const gateway = mockGateway(makeUsage({ burstPercent: 42 }));
    service = new UsageMonitorService(gateway, makeAgentService());

    const result = await service.refreshNow();
    expect(result?.burst.used_percent).toBe(42);
    expect(service.getLatest()?.burst.used_percent).toBe(42);
  });

  it("collapses bursts of LlmActivity into at most one trailing fetch", async () => {
    const gateway = mockGateway(makeUsage({ burstPercent: 10 }));
    const agent = makeAgentService();
    service = new UsageMonitorService(gateway, agent);
    service.init();
    await vi.advanceTimersByTimeAsync(0);
    expect(gateway.fetchUsage).toHaveBeenCalledTimes(1);

    agent.emit(AgentServiceEvent.LlmActivity, undefined);
    agent.emit(AgentServiceEvent.LlmActivity, undefined);
    agent.emit(AgentServiceEvent.LlmActivity, undefined);
    agent.emit(AgentServiceEvent.LlmActivity, undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(gateway.fetchUsage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(gateway.fetchUsage).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    agent.emit(AgentServiceEvent.LlmActivity, undefined);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(gateway.fetchUsage).toHaveBeenCalledTimes(3);
  });

  it("unsubscribes from agent events on stop()", async () => {
    const gateway = mockGateway(makeUsage({ burstPercent: 10 }));
    const agent = makeAgentService();
    service = new UsageMonitorService(gateway, agent);
    service.init();
    await vi.advanceTimersByTimeAsync(0);
    const baseline = (gateway.fetchUsage as ReturnType<typeof vi.fn>).mock.calls
      .length;

    service.stop();
    agent.emit(AgentServiceEvent.LlmActivity, undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(gateway.fetchUsage).toHaveBeenCalledTimes(baseline);
  });
});
