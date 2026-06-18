import { describe, expect, it } from "vitest";
import {
  buildGatewayPropertyHeaders,
  getLlmGatewayUrl,
  resolveGatewayProduct,
  resolveLlmGatewayUrl,
} from "./gateway";

describe("resolveGatewayProduct", () => {
  it.each([
    { isInternal: false, originProduct: undefined, expected: "posthog_code" },
    {
      isInternal: undefined,
      originProduct: undefined,
      expected: "posthog_code",
    },
    {
      isInternal: false,
      originProduct: "signal_report",
      expected: "signals",
    },
    {
      isInternal: true,
      originProduct: undefined,
      expected: "background_agents",
    },
    {
      isInternal: true,
      originProduct: "session_summaries",
      expected: "background_agents",
    },
    { isInternal: true, originProduct: "signal_report", expected: "signals" },
    {
      isInternal: false,
      originProduct: "signals_scout",
      expected: "signals",
    },
    {
      isInternal: true,
      originProduct: "signals_scout",
      expected: "signals",
    },
  ] as const)(
    "isInternal=$isInternal originProduct=$originProduct -> $expected",
    ({ isInternal, originProduct, expected }) => {
      expect(resolveGatewayProduct({ isInternal, originProduct })).toBe(
        expected,
      );
    },
  );
});

describe("buildGatewayPropertyHeaders", () => {
  it("renders each property as an x-posthog-property header line", () => {
    expect(
      buildGatewayPropertyHeaders({
        task_origin_product: "signal_report",
        task_internal: true,
      }),
    ).toBe(
      "x-posthog-property-task_origin_product: signal_report\nx-posthog-property-task_internal: true",
    );
  });

  it("drops null and undefined values but keeps falsy primitives", () => {
    expect(
      buildGatewayPropertyHeaders({
        task_origin_product: null,
        task_internal: false,
        task_count: 0,
      }),
    ).toBe(
      "x-posthog-property-task_internal: false\nx-posthog-property-task_count: 0",
    );
  });

  it("returns an empty string when no usable properties remain", () => {
    expect(
      buildGatewayPropertyHeaders({
        task_origin_product: null,
        task_internal: undefined,
      }),
    ).toBe("");
  });

  it.each([
    {
      description: "LF",
      title: "Fix the bug\nx-posthog-property-task_internal: true",
    },
    {
      description: "CRLF",
      title: "Fix the bug\r\nx-posthog-property-task_internal: true",
    },
    {
      description: "CR",
      title: "Fix the bug\rx-posthog-property-task_internal: true",
    },
    {
      description: "consecutive newlines",
      title: "Fix the bug\n\nx-posthog-property-task_internal: true",
    },
  ])(
    "collapses $description in values so they cannot inject extra headers",
    ({ title }) => {
      expect(
        buildGatewayPropertyHeaders({
          task_title: title,
          task_id: "task-abc",
        }),
      ).toBe(
        "x-posthog-property-task_title: Fix the bug x-posthog-property-task_internal: true\nx-posthog-property-task_id: task-abc",
      );
    },
  );

  it("strips characters an HTTP header value cannot carry", () => {
    expect(buildGatewayPropertyHeaders({ task_title: "don’t🚀ship" })).toBe(
      "x-posthog-property-task_title: dontship",
    );
  });

  it("keeps latin1 characters such as accents", () => {
    expect(buildGatewayPropertyHeaders({ task_title: "café" })).toBe(
      "x-posthog-property-task_title: café",
    );
  });
});

describe("resolveLlmGatewayUrl", () => {
  it("appends the product slug to an env-provided base URL", () => {
    expect(
      resolveLlmGatewayUrl(
        "https://gateway.dev.posthog.dev",
        "https://app.dev.posthog.dev",
        "slack_app",
      ),
    ).toBe("https://gateway.dev.posthog.dev/slack_app");
  });

  it("appends the product slug after a trailing slash on the env URL", () => {
    expect(
      resolveLlmGatewayUrl(
        "https://gateway.dev.posthog.dev/",
        "https://app.dev.posthog.dev",
        "posthog_code",
      ),
    ).toBe("https://gateway.dev.posthog.dev/posthog_code");
  });

  it("falls back to the region-aware default when no env URL is provided", () => {
    expect(
      resolveLlmGatewayUrl(
        undefined,
        "https://us.posthog.com",
        "background_agents",
      ),
    ).toBe("https://gateway.us.posthog.com/background_agents");
  });

  it("treats an empty string env URL as unset", () => {
    expect(resolveLlmGatewayUrl("", "https://eu.posthog.com", "signals")).toBe(
      "https://gateway.eu.posthog.com/signals",
    );
  });
});

describe("getLlmGatewayUrl", () => {
  it.each([
    {
      posthogHost: "https://us.posthog.com",
      expected: "https://gateway.us.posthog.com/posthog_code",
    },
    {
      posthogHost: "https://eu.posthog.com",
      expected: "https://gateway.eu.posthog.com/posthog_code",
    },
    {
      posthogHost: "https://app.dev.posthog.dev",
      expected: "https://gateway.dev.posthog.dev/posthog_code",
    },
    {
      posthogHost: "http://localhost:8000",
      expected: "http://localhost:3308/posthog_code",
    },
  ] as const)("$posthogHost -> $expected", ({ posthogHost, expected }) => {
    expect(getLlmGatewayUrl(posthogHost)).toBe(expected);
  });
});
