import { describe, expect, it } from "vitest";
import { gravatarUrl } from "./useUserAvatar";

describe("gravatarUrl", () => {
  it("hashes the normalized email into a d=404 Gravatar URL", async () => {
    const url = await gravatarUrl("  Someone@PostHog.com ");
    expect(url).toBe(await gravatarUrl("someone@posthog.com"));
    expect(url).toMatch(
      /^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{64}\?s=96&d=404$/,
    );
  });
});
