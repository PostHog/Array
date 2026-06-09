import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    scope: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  EMPTY_HOME_SNAPSHOT,
  HomeEvent,
  type HomeSnapshot,
} from "@shared/types/home-snapshot";
import type { AuthService } from "../auth/service";
import { HomeService } from "./service";

const POLL_INTERVAL_MS = 120_000;

const SNAP_WITH: HomeSnapshot = {
  activeAgents: [
    {
      taskId: "t1",
      title: "Fix bug",
      repoName: null,
      branch: null,
      status: "in_progress",
      lastActivityAt: 1,
      needsPermission: false,
      cloudPrUrl: null,
    },
  ],
  needsAttention: [],
  inProgress: [],
};

function res(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const fetchMock = vi.fn();
let projectId: string | null;
const authService = {
  getState: () => ({ currentProjectId: projectId }),
  authenticatedProjectFetch: fetchMock,
} as unknown as AuthService;

let service: HomeService;
let events: HomeSnapshot[];

beforeEach(() => {
  fetchMock.mockReset();
  projectId = "proj_1";
  events = [];
  service = new HomeService(authService);
  service.on(HomeEvent.SnapshotUpdated, (s) => events.push(s));
});

describe("HomeService.getSnapshot", () => {
  it("returns EMPTY_HOME_SNAPSHOT without fetching when no project is selected", async () => {
    projectId = null;
    await expect(service.getSnapshot()).resolves.toEqual(EMPTY_HOME_SNAPSHOT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the parsed snapshot on a successful response", async () => {
    fetchMock.mockResolvedValue(res(200, SNAP_WITH));
    await expect(service.getSnapshot()).resolves.toEqual(SNAP_WITH);
    expect(fetchMock).toHaveBeenCalledWith("code_home/", { method: "GET" });
  });

  it("returns EMPTY_HOME_SNAPSHOT on a non-ok response", async () => {
    fetchMock.mockResolvedValue(res(503, {}));
    await expect(service.getSnapshot()).resolves.toEqual(EMPTY_HOME_SNAPSHOT);
  });

  it("returns EMPTY_HOME_SNAPSHOT when the body fails schema validation", async () => {
    fetchMock.mockResolvedValue(res(200, { bogus: true }));
    await expect(service.getSnapshot()).resolves.toEqual(EMPTY_HOME_SNAPSHOT);
  });

  it("returns EMPTY_HOME_SNAPSHOT when the fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(service.getSnapshot()).resolves.toEqual(EMPTY_HOME_SNAPSHOT);
  });
});

describe("HomeService.refresh", () => {
  it("POSTs the refresh endpoint then returns the latest snapshot", async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, {}))
      .mockResolvedValueOnce(res(200, SNAP_WITH));
    await expect(service.refresh()).resolves.toEqual(SNAP_WITH);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "code_home/refresh/", {
      method: "POST",
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "code_home/", {
      method: "GET",
    });
  });

  it("still returns a snapshot when the refresh POST fails", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("refresh failed"))
      .mockResolvedValueOnce(res(200, SNAP_WITH));
    await expect(service.refresh()).resolves.toEqual(SNAP_WITH);
  });
});

describe("HomeService poll loop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  it("emits SnapshotUpdated when the snapshot changes between polls", async () => {
    fetchMock
      .mockResolvedValueOnce(res(200, SNAP_WITH))
      .mockResolvedValueOnce(res(200, EMPTY_HOME_SNAPSHOT));
    service.init();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(events).toEqual([SNAP_WITH, EMPTY_HOME_SNAPSHOT]);
  });

  it("does not re-emit an unchanged snapshot", async () => {
    fetchMock.mockResolvedValue(res(200, SNAP_WITH));
    service.init();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(events).toEqual([SNAP_WITH]);
  });

  it("does not emit when a poll fails", async () => {
    fetchMock.mockResolvedValue(res(500, {}));
    service.init();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(events).toEqual([]);
  });

  it("getSnapshot seeds the dedup state so a matching first poll does not emit", async () => {
    fetchMock.mockResolvedValue(res(200, SNAP_WITH));
    await service.getSnapshot();
    service.init();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(events).toEqual([]);
  });

  it("dispose stops the timer", async () => {
    fetchMock.mockResolvedValue(res(200, SNAP_WITH));
    service.init();
    service.dispose();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});
