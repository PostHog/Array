import { describe, expect, it } from "vitest";
import { buildGatewayPropertyHeaders, resolveGatewayProduct } from "./gateway";

describe("resolveGatewayProduct", () => {
  it("returns posthog_code for non-internal tasks", () => {
    expect(resolveGatewayProduct({ isInternal: false })).toBe("posthog_code");
    expect(resolveGatewayProduct()).toBe("posthog_code");
  });

  it("returns posthog_code for non-internal tasks even when origin_product is signal_report", () => {
    expect(
      resolveGatewayProduct({
        isInternal: false,
        originProduct: "signal_report",
      }),
    ).toBe("posthog_code");
  });

  it("returns background_agents for internal tasks without origin_product", () => {
    expect(resolveGatewayProduct({ isInternal: true })).toBe(
      "background_agents",
    );
  });

  it("returns background_agents for internal tasks with a non-signal origin_product", () => {
    expect(
      resolveGatewayProduct({
        isInternal: true,
        originProduct: "session_summaries",
      }),
    ).toBe("background_agents");
  });

  it("returns signals for internal tasks with origin_product 'signal_report'", () => {
    expect(
      resolveGatewayProduct({
        isInternal: true,
        originProduct: "signal_report",
      }),
    ).toBe("signals");
  });
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
