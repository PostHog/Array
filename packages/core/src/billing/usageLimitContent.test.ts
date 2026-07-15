import { describe, expect, it } from "vitest";
import {
  deriveUsageLimitCause,
  seatEraLimitContent,
  usageBasedLimitContent,
} from "./usageLimitContent";

describe("deriveUsageLimitCause", () => {
  it.each([
    ["model_gate", "burst", "model_gate"],
    [null, "burst", "user_daily_limit"],
    [null, "sustained", "user_monthly_limit"],
    // No cause and no bucket (e.g. an upstream provider's own rate limit):
    // stay generic instead of blaming the org's billing.
    [null, null, null],
  ] as const)("cause %s + bucket %s -> %s", (cause, bucket, expected) => {
    expect(deriveUsageLimitCause(cause, bucket)).toBe(expected);
  });
});

describe("usageBasedLimitContent", () => {
  it("names the gated model and offers a payment method", () => {
    const content = usageBasedLimitContent({
      cause: "model_gate",
      model: "Claude Opus 4.8",
      resetLabel: null,
      billed: false,
    });
    expect(content.title).toBe("Unlock premium models");
    expect(content.description).toContain("Claude Opus 4.8 isn't");
    expect(content.actionLabel).toBe("Add payment method");
  });

  it("falls back to generic wording when the gated model is unknown", () => {
    const content = usageBasedLimitContent({
      cause: "model_gate",
      model: null,
      resetLabel: null,
      billed: undefined,
    });
    expect(content.description).toContain("This model isn't");
  });

  it.each([
    // Confirmed-free org: allocation used up, the fix is adding a card.
    [false, "Free usage used up", "Add payment method"],
    // Billed org: the fix is raising the spend limit.
    [true, "Organization usage limit reached", "Manage billing"],
    // Unknown billed state must not read as free.
    [undefined, "Organization usage limit reached", "Manage billing"],
  ] as const)(
    "org_limit with billed=%s -> %s / %s",
    (billed, title, actionLabel) => {
      const content = usageBasedLimitContent({
        cause: "org_limit",
        model: null,
        resetLabel: null,
        billed,
      });
      expect(content.title).toBe(title);
      expect(content.actionLabel).toBe(actionLabel);
    },
  );

  it.each([
    ["user_daily_limit", "Free daily limit reached"],
    ["user_monthly_limit", "Free monthly limit reached"],
  ] as const)("%s carries the reset hint", (cause, title) => {
    const content = usageBasedLimitContent({
      cause,
      model: null,
      resetLabel: "Resets in 2h",
      billed: false,
    });
    expect(content.title).toBe(title);
    expect(content.description).toContain("Resets in 2h");
    expect(content.actionLabel).toBe("Add payment method");
  });

  it("renders generic copy without a billing CTA when the cause is unknown", () => {
    const content = usageBasedLimitContent({
      cause: null,
      model: null,
      resetLabel: null,
      billed: true,
    });
    expect(content.title).toBe("Usage limit reached");
    expect(content.actionLabel).toBeNull();
    expect(content.dismissLabel).toBe("Got it");
  });
});

describe("seatEraLimitContent", () => {
  it("keeps the Pro cap copy with no upgrade action", () => {
    const content = seatEraLimitContent({
      bucket: "sustained",
      isPro: true,
      resetLabel: "Resets in 3d",
    });
    expect(content.title).toBe("Monthly limit reached");
    expect(content.description).toContain("monthly usage cap");
    expect(content.actionLabel).toBeNull();
    expect(content.dismissLabel).toBe("Got it");
  });

  it("keeps the free-plan upgrade pitch", () => {
    const content = seatEraLimitContent({
      bucket: "burst",
      isPro: false,
      resetLabel: null,
    });
    expect(content.title).toBe("Daily limit reached");
    expect(content.description).toContain("Upgrade to Pro for 40×");
    expect(content.actionLabel).toBe("See Pro");
  });
});
