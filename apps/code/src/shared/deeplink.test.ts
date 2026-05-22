import { describe, expect, it } from "vitest";
import { buildInboxDeeplink } from "./deeplink";

describe("buildInboxDeeplink", () => {
  it("returns just the UUID when no title is given", () => {
    expect(buildInboxDeeplink("abc-123", null, { isDevBuild: false })).toBe(
      "posthog-code://inbox/abc-123",
    );
    expect(
      buildInboxDeeplink("abc-123", undefined, { isDevBuild: false }),
    ).toBe("posthog-code://inbox/abc-123");
    expect(buildInboxDeeplink("abc-123", "", { isDevBuild: false })).toBe(
      "posthog-code://inbox/abc-123",
    );
  });

  it("emits `--` for runs that mix a colon with other unsafe chars", () => {
    expect(
      buildInboxDeeplink("abc-123", "fix(inbox): Add foo", {
        isDevBuild: false,
      }),
    ).toBe("posthog-code://inbox/abc-123/fix-inbox--Add-foo");
  });

  it("emits a single `-` for a colon-only run", () => {
    expect(
      buildInboxDeeplink("abc-123", "feat:bar", { isDevBuild: false }),
    ).toBe("posthog-code://inbox/abc-123/feat-bar");
  });

  it("omits the slug when the title slugifies to empty", () => {
    expect(buildInboxDeeplink("abc-123", ":::", { isDevBuild: false })).toBe(
      "posthog-code://inbox/abc-123",
    );
    expect(buildInboxDeeplink("abc-123", "   ", { isDevBuild: false })).toBe(
      "posthog-code://inbox/abc-123",
    );
  });

  it("uses the dev scheme when isDevBuild is true", () => {
    expect(
      buildInboxDeeplink("abc-123", "Hello World", { isDevBuild: true }),
    ).toBe("posthog-code-dev://inbox/abc-123/Hello-World");
  });

  it("preserves URL-unreserved punctuation (- _ . ~)", () => {
    expect(
      buildInboxDeeplink("abc-123", "v1.2.3_final~ish", { isDevBuild: false }),
    ).toBe("posthog-code://inbox/abc-123/v1.2.3_final~ish");
  });

  it("collapses runs of unsafe punctuation into a single hyphen", () => {
    expect(
      buildInboxDeeplink("abc-123", "Cost $5, 50% off!", { isDevBuild: false }),
    ).toBe("posthog-code://inbox/abc-123/Cost-5-50-off");
  });

  it("folds accented Latin letters to their ASCII base", () => {
    expect(
      buildInboxDeeplink("abc-123", "café résumé naïve", { isDevBuild: false }),
    ).toBe("posthog-code://inbox/abc-123/cafe-resume-naive");
  });

  it("hyphenizes non-Latin scripts that have no ASCII fold", () => {
    expect(
      buildInboxDeeplink("abc-123", "Hello Привет world", {
        isDevBuild: false,
      }),
    ).toBe("posthog-code://inbox/abc-123/Hello-world");
  });
});
