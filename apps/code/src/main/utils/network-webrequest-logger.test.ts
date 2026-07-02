import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./logger", () => ({
  networkLog: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./network-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./network-log")>();
  return {
    ...actual,
    recordNetworkRequest: vi.fn(),
  };
});

import type { DevNetworkService } from "../services/dev-network/service";
import type { ObservableWebRequest } from "./network-webrequest-logger";
import { contentLengthFromHeaders } from "./network-webrequest-logger";

type Listeners = {
  onBeforeRequest: Parameters<ObservableWebRequest["onBeforeRequest"]>[1];
  onCompleted: Parameters<ObservableWebRequest["onCompleted"]>[1];
  onErrorOccurred: Parameters<ObservableWebRequest["onErrorOccurred"]>[1];
};

function fakeWebRequest(): { webRequest: ObservableWebRequest } & {
  listeners: Listeners;
} {
  const listeners = {} as Listeners;
  return {
    listeners,
    webRequest: {
      onBeforeRequest: (_filter, listener) => {
        listeners.onBeforeRequest = listener;
      },
      onCompleted: (_filter, listener) => {
        listeners.onCompleted = listener;
      },
      onErrorOccurred: (_filter, listener) => {
        listeners.onErrorOccurred = listener;
      },
    },
  };
}

function fakeDevNetwork() {
  return { recordExternal: vi.fn() } as unknown as DevNetworkService & {
    recordExternal: ReturnType<typeof vi.fn>;
  };
}

async function installFresh() {
  vi.resetModules();
  const { installRendererNetworkLogging } = await import(
    "./network-webrequest-logger"
  );
  const { recordNetworkRequest } = await import("./network-log");
  const { listeners, webRequest } = fakeWebRequest();
  const devNetwork = fakeDevNetwork();
  installRendererNetworkLogging(webRequest, devNetwork);
  return { listeners, devNetwork, record: vi.mocked(recordNetworkRequest) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("contentLengthFromHeaders", () => {
  it.each([
    [{ "Content-Length": ["1834"] }, 1834],
    [{ "content-length": ["42"] }, 42],
    [{ "CONTENT-LENGTH": ["7"] }, 7],
    [{ "Content-Type": ["application/json"] }, null],
    [{ "Content-Length": [] as string[] }, null],
    [{ "Content-Length": ["abc"] }, null],
    [{}, null],
    [undefined, null],
  ])("%o -> %s", (headers, expected) => {
    expect(contentLengthFromHeaders(headers)).toBe(expected);
  });
});

describe("installRendererNetworkLogging", () => {
  it("always invokes the onBeforeRequest callback", async () => {
    const { listeners } = await installFresh();
    const callback = vi.fn();

    listeners.onBeforeRequest(
      { id: 1, method: "GET", url: "https://example.com/" },
      callback,
    );

    expect(callback).toHaveBeenCalledWith({});
  });

  it("records a completed request and mirrors it to the dev toolbar", async () => {
    const { listeners, devNetwork, record } = await installFresh();

    listeners.onBeforeRequest(
      { id: 7, method: "GET", url: "https://us.posthog.com/api/" },
      vi.fn(),
    );
    listeners.onCompleted({
      id: 7,
      method: "GET",
      url: "https://us.posthog.com/api/",
      statusCode: 200,
      responseHeaders: { "Content-Length": ["1834"] },
    });

    expect(record).toHaveBeenCalledWith({
      origin: "renderer",
      method: "GET",
      url: "https://us.posthog.com/api/",
      status: 200,
      durationMs: expect.any(Number),
      bytes: 1834,
    });
    expect(devNetwork.recordExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: "renderer",
        status: 200,
        ok: true,
        bytes: 1834,
      }),
    );
  });

  it("records a failed request with the chromium error string", async () => {
    const { listeners, devNetwork, record } = await installFresh();

    listeners.onBeforeRequest(
      { id: 9, method: "POST", url: "https://example.com/x" },
      vi.fn(),
    );
    listeners.onErrorOccurred({
      id: 9,
      method: "POST",
      url: "https://example.com/x",
      error: "net::ERR_CONNECTION_RESET",
    });

    expect(record).toHaveBeenCalledWith({
      origin: "renderer",
      method: "POST",
      url: "https://example.com/x",
      status: null,
      durationMs: expect.any(Number),
      bytes: null,
      error: "net::ERR_CONNECTION_RESET",
    });
    expect(devNetwork.recordExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: "net::ERR_CONNECTION_RESET",
      }),
    );
  });

  it("marks non-2xx completions as not ok", async () => {
    const { listeners, devNetwork } = await installFresh();

    listeners.onCompleted({
      id: 3,
      method: "GET",
      url: "https://example.com/missing",
      statusCode: 404,
    });

    expect(devNetwork.recordExternal).toHaveBeenCalledWith(
      expect.objectContaining({ status: 404, ok: false, bytes: null }),
    );
  });

  it("still records completions whose start entry was evicted", async () => {
    const { listeners, record } = await installFresh();

    listeners.onCompleted({
      id: 999,
      method: "GET",
      url: "https://example.com/",
      statusCode: 200,
    });

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ status: 200, durationMs: 0 }),
    );
  });
});
