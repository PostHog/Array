import { describe, expect, it, vi } from "vitest";
import { checkoutExistingPullRequest } from "./pr-checkout";

describe("checkoutExistingPullRequest", () => {
  it.each([
    {
      name: "skips checkout when the pull request branch is already active",
      currentBranch: "posthog-code/fix-checkout",
      expectedStatus: "already_active",
      expectedCheckoutCalls: 0,
    },
    {
      name: "checks out the pull request when another branch is active",
      currentBranch: "main",
      expectedStatus: "checked_out",
      expectedCheckoutCalls: 1,
    },
  ])(
    "$name",
    async ({ currentBranch, expectedStatus, expectedCheckoutCalls }) => {
      const runCommand = vi.fn(
        async (
          executable: string,
          args: string[],
        ): Promise<{ stdout: string }> => {
          if (executable === "git") {
            return { stdout: `${currentBranch}\n` };
          }
          if (args[1] === "view") {
            return { stdout: "posthog-code/fix-checkout\n" };
          }
          return { stdout: "" };
        },
      );

      const result = await checkoutExistingPullRequest({
        repositoryPath: "/tmp/repo",
        prUrl: "https://github.com/PostHog/code/pull/1",
        runCommand,
      });

      expect(result.status).toBe(expectedStatus);
      expect(
        runCommand.mock.calls.filter(
          ([executable, args]) =>
            executable === "gh" && args[0] === "pr" && args[1] === "checkout",
        ),
      ).toHaveLength(expectedCheckoutCalls);
    },
  );

  it("returns a failure so startup can fall back to agent checkout", async () => {
    const result = await checkoutExistingPullRequest({
      repositoryPath: "/tmp/repo",
      prUrl: "https://github.com/PostHog/code/pull/1",
      runCommand: vi.fn().mockRejectedValue(new Error("gh unavailable")),
    });

    expect(result).toEqual({ status: "failed", error: "gh unavailable" });
  });
});
