import { describe, expect, it } from "vitest";
import { usageLimitContent } from "./usageLimitContent";

describe("usageLimitContent", () => {
  it("names the gated model and offers a payment method", () => {
    const content = usageLimitContent({
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
    const content = usageLimitContent({
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
      const content = usageLimitContent({
        cause: "org_limit",
        model: null,
        resetLabel: null,
        billed,
      });
      expect(content.title).toBe(title);
      expect(content.actionLabel).toBe(actionLabel);
    },
  );

  it("renders generic copy without a billing CTA when the cause is unknown", () => {
    const content = usageLimitContent({
      cause: null,
      model: null,
      resetLabel: "Resets in 2h",
      billed: true,
    });
    expect(content.title).toBe("Usage limit reached");
    expect(content.description).toContain("Resets in 2h");
    expect(content.actionLabel).toBeNull();
    expect(content.dismissLabel).toBe("Got it");
  });
});
