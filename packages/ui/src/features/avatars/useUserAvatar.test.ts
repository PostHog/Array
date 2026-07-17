import { describe, expect, it } from "vitest";
import { buildMemberAvatarIndex, gravatarUrl } from "./useUserAvatar";

describe("gravatarUrl", () => {
  it("hashes the normalized email into a d=404 Gravatar URL", async () => {
    const url = await gravatarUrl("  Someone@PostHog.com ");
    expect(url).toBe(await gravatarUrl("someone@posthog.com"));
    expect(url).toMatch(
      /^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{64}\?s=96&d=404$/,
    );
  });
});

describe("buildMemberAvatarIndex", () => {
  it("indexes members with avatars by uuid and lowercased email", () => {
    const index = buildMemberAvatarIndex([
      {
        id: "m1",
        user: { id: 1, uuid: "u1", email: "Raquel@PostHog.com" },
        avatar_url: "https://cdn/raquel.png",
      },
      {
        id: "m2",
        user: { id: 2, uuid: "u2", email: "no-avatar@posthog.com" },
        avatar_url: null,
      },
    ]);
    expect(index.get("u1")).toBe("https://cdn/raquel.png");
    expect(index.get("raquel@posthog.com")).toBe("https://cdn/raquel.png");
    expect(index.has("u2")).toBe(false);
    expect(index.size).toBe(2);
  });
});
