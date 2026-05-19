import { describe, expect, it } from "vitest";
import {
  githubInstallationSettingsUrl,
  resolveGithubInstallationId,
} from "./githubInstallationSettingsUrl";

describe("githubInstallationSettingsUrl", () => {
  it("uses org settings for organization accounts", () => {
    expect(
      githubInstallationSettingsUrl("99", {
        type: "Organization",
        name: "posthog",
      }),
    ).toBe(
      "https://github.com/organizations/posthog/settings/installations/99",
    );
  });

  it("uses user settings for personal accounts", () => {
    expect(
      githubInstallationSettingsUrl("42", { type: "User", name: "octocat" }),
    ).toBe("https://github.com/settings/installations/42");
  });
});

describe("resolveGithubInstallationId", () => {
  it("prefers top-level installation_id then id then config", () => {
    expect(
      resolveGithubInstallationId({
        id: 99,
        kind: "github",
        installation_id: "a",
        config: { installation_id: "c" },
      }),
    ).toBe("a");
    expect(
      resolveGithubInstallationId({
        id: 1,
        kind: "github",
        integration_id: 12345,
      }),
    ).toBe("12345");
    expect(
      resolveGithubInstallationId({
        id: 1,
        kind: "github",
        config: { installation_id: "c" },
      }),
    ).toBe("c");
  });
});
