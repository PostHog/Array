import { errorTrackingIssueUrl } from "@posthog/ui/utils/posthogLinks";
import { describe, expect, it, vi } from "vitest";

vi.mock("@posthog/ui/utils/urls", () => ({
  getPostHogUrl: (path: string) => `https://us.posthog.com${path}`,
}));

describe("errorTrackingIssueUrl", () => {
  it("links to the issue when no fingerprint is provided", () => {
    expect(
      errorTrackingIssueUrl("issue id/with?chars", {
        projectId: 123,
        cloudRegion: "us",
      }),
    ).toBe(
      "https://us.posthog.com/project/123/error_tracking/issue%20id%2Fwith%3Fchars",
    );
  });

  it("includes a fingerprint query parameter for merged issue redirects", () => {
    expect(
      errorTrackingIssueUrl("old-issue-id", {
        projectId: 123,
        cloudRegion: "us",
        fingerprint: "fp/value with spaces&eq=1",
      }),
    ).toBe(
      "https://us.posthog.com/project/123/error_tracking/old-issue-id?fingerprint=fp%2Fvalue%20with%20spaces%26eq%3D1",
    );
  });
});
