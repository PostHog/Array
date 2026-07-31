import type { RootLogger } from "@posthog/di/logger";
import type { IEmbeddedBrowser } from "@posthog/platform/embedded-browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProductViewService } from "./productView";

const runHogQLQuery = vi.fn();
vi.mock("../canvas/posthogApi", () => ({
  runHogQLQuery: (...args: unknown[]) => runHogQLQuery(...args),
}));

const fakeLogger = {
  scope: () => ({ warn: vi.fn() }),
} as unknown as RootLogger;

function makeBrowser() {
  return {
    create: vi.fn().mockResolvedValue(undefined),
    navigate: vi.fn().mockResolvedValue(undefined),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    destroy: vi.fn().mockResolvedValue(undefined),
    getPageState: vi.fn().mockReturnValue(null),
    setInspectMode: vi.fn(),
    pushOverlayData: vi.fn(),
    events: vi.fn(),
  } satisfies IEmbeddedBrowser;
}

function makeAuth(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getValidAccessToken: vi.fn().mockResolvedValue({
      accessToken: "t",
      apiHost: "https://us.posthog.com",
    }),
    getState: vi.fn().mockReturnValue({ currentProjectId: 2 }),
    authenticatedFetch: vi.fn(),
    ...overrides,
  } as never;
}

describe("ProductViewService navigation guards", () => {
  let browser: ReturnType<typeof makeBrowser>;
  let service: ProductViewService;

  beforeEach(() => {
    browser = makeBrowser();
    service = new ProductViewService(browser, makeAuth(), fakeLogger);
  });

  const bounds = { x: 0, y: 0, width: 800, height: 600 };

  it("opens plain web URLs", async () => {
    await service.open({ viewId: "v1", url: "https://posthog.com", bounds });
    expect(browser.create).toHaveBeenCalledWith({
      viewId: "v1",
      url: "https://posthog.com/",
      bounds,
    });
  });

  it.each(["file:///etc/passwd", "chrome://settings", "javascript:alert(1)"])(
    "refuses to open %s",
    async (url) => {
      await expect(service.open({ viewId: "v1", url, bounds })).rejects.toThrow(
        /http/i,
      );
      expect(browser.create).not.toHaveBeenCalled();
    },
  );

  it("refuses to navigate to a non-web URL", async () => {
    await expect(service.navigate("v1", "file:///x")).rejects.toThrow(/http/i);
    expect(browser.navigate).not.toHaveBeenCalled();
  });
});

describe("ProductViewService overlay pipeline", () => {
  it("matches reported elements against elements/stats for the data project and pushes halos", async () => {
    vi.useFakeTimers();
    const statsResponse = {
      results: [
        {
          count: 32413,
          hash: "h",
          type: "$autocapture",
          elements: [
            {
              text: "Open PostHog",
              tag_name: "a",
              attr_class: [],
              href: "https://us.posthog.com",
              attr_id: null,
              nth_child: 1,
              nth_of_type: 1,
              attributes: {},
              order: 0,
            },
          ],
        },
      ],
    };
    const authenticatedFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => statsResponse,
    });
    const browser = makeBrowser();
    const reported = {
      type: "elements-reported" as const,
      viewId: "v1",
      pageUrl: "https://posthog.com/",
      elements: [
        {
          selectorHash: "anchor-us",
          tag: "a",
          dataAttr: null,
          id: null,
          classes: [],
          href: "https://us.posthog.com",
          text: "Open PostHog",
          nthChildPath: "a:1",
        },
      ],
    };
    browser.events.mockImplementation(async function* () {
      yield reported;
      await new Promise(() => {});
    });

    const service = new ProductViewService(
      browser,
      makeAuth({ authenticatedFetch }),
      fakeLogger,
    );
    await service.open({
      viewId: "v1",
      url: "https://posthog.com",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      dataProjectId: 2,
    });

    await vi.advanceTimersByTimeAsync(500);
    vi.useRealTimers();
    // Give the fetch → match → push chain a real tick to settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(authenticatedFetch).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("/api/projects/2/elements/stats/"),
    );
    expect(browser.pushOverlayData).toHaveBeenCalledWith({
      viewId: "v1",
      items: [
        {
          selectorHash: "anchor-us",
          halo: "green",
          label: "32K clicks",
        },
      ],
    });
  });
});

describe("ProductViewService.suggestProductUrls", () => {
  it("merges app_urls with pageview hosts and survives either source failing", async () => {
    const browser = makeBrowser();
    const auth = makeAuth({
      authenticatedFetch: vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ app_urls: ["https://us.posthog.com"] }),
      }),
    });
    runHogQLQuery.mockResolvedValue({
      columns: ["host", "pageviews"],
      results: [["eu.posthog.com", 42]],
    });

    const service = new ProductViewService(browser, auth, fakeLogger);
    const suggestions = await service.suggestProductUrls();
    expect(suggestions.map((s) => s.url)).toEqual([
      "https://us.posthog.com",
      "https://eu.posthog.com",
    ]);

    // HogQL source failing must not sink the whole call.
    runHogQLQuery.mockRejectedValue(new Error("query down"));
    const degraded = await service.suggestProductUrls();
    expect(degraded.map((s) => s.url)).toEqual(["https://us.posthog.com"]);
  });
});
