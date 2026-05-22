import { describe, expect, it } from "vitest";
import { buildGatewayPropertyHeaders, resolveGatewayProduct } from "./gateway";

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
      expected: "posthog_code",
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
});
