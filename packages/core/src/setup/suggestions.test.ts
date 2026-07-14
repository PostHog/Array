import {
  buildPosthogSetupSuggestion,
  buildSdkHealthSuggestion,
  buildStaleFlagSuggestion,
  type StaleFlagPayload,
} from "@posthog/core/setup/suggestions";
import { describe, expect, it } from "vitest";

describe("buildStaleFlagSuggestion", () => {
  const flag: StaleFlagPayload = {
    flagKey: "old-checkout",
    referenceCount: 3,
    references: [
      { file: "src/a.ts", line: 10, method: "isFeatureEnabled" },
      { file: "src/b.ts", line: 22, method: "useFeatureFlag" },
    ],
  };

  it("derives a stable id from the flag key so dismissal sticks", () => {
    expect(buildStaleFlagSuggestion(flag).id).toBe(
      "posthog-stale-flag-old-checkout",
    );
  });

  it("anchors file/lineHint to the first reference", () => {
    const task = buildStaleFlagSuggestion(flag);
    expect(task.file).toBe("src/a.ts");
    expect(task.lineHint).toBe(10);
  });

  it("lists references and a '…and N more' tail when truncated", () => {
    const recommendation = buildStaleFlagSuggestion(flag).recommendation ?? "";
    expect(recommendation).toContain("- src/a.ts:10 (isFeatureEnabled)");
    expect(recommendation).toContain("- src/b.ts:22 (useFeatureFlag)");
    // referenceCount 3 with 2 shown → 1 more
    expect(recommendation).toContain("…and 1 more.");
  });

  it("omits the truncation tail when all references are shown", () => {
    const task = buildStaleFlagSuggestion({ ...flag, referenceCount: 2 });
    expect(task.recommendation).not.toContain("more.");
  });

  it("singularizes the reference count in the description", () => {
    const task = buildStaleFlagSuggestion({
      flagKey: "f",
      referenceCount: 1,
      references: [{ file: "x.ts", line: 1, method: "m" }],
    });
    expect(task.description).toContain("referenced in 1 place ");
  });
});

describe("buildSdkHealthSuggestion", () => {
  it("is a stable enricher posthog_setup suggestion", () => {
    const task = buildSdkHealthSuggestion();
    expect(task).toMatchObject({
      id: "posthog-sdk-health",
      source: "enricher",
      category: "posthog_setup",
      prompt: "/diagnosing-sdk-health",
    });
  });
});

describe("buildPosthogSetupSuggestion", () => {
  it("returns the install suggestion when not installed", () => {
    const task = buildPosthogSetupSuggestion("not_installed");
    expect(task.id).toBe("posthog-setup");
    expect(task.prompt?.startsWith("/instrument-integration")).toBe(true);
  });

  it("returns the finish-init suggestion when installed but not initialized", () => {
    const task = buildPosthogSetupSuggestion("installed_no_init");
    expect(task.id).toBe("posthog-finish-init");
    expect(task.prompt).toContain("skip install steps");
  });

  it.each(["not_installed", "installed_no_init"] as const)(
    "requires a hosting-provider env var checklist (%s)",
    (state) => {
      const prompt = buildPosthogSetupSuggestion(state).prompt ?? "";
      expect(prompt).toContain("production will send no events");
      expect(prompt).toContain("Never put secret values in a PR body");
    },
  );

  // The prompt runs in cloud, worktree and local modes, and no mode opens a PR
  // automatically — so it has to name a delivery target for both endings.
  it.each(["not_installed", "installed_no_init"] as const)(
    "routes the checklist to a PR body or the final message, per run type (%s)",
    (state) => {
      const prompt = buildPosthogSetupSuggestion(state).prompt ?? "";
      expect(prompt).toContain(
        "Before you merge: set environment variables in <provider>",
      );
      expect(prompt).toContain(
        "Before you deploy: set environment variables in <provider>",
      );
      expect(prompt).toContain("not opening a pull request");
    },
  );

  it.each([
    ["Vercel", "vercel env add <KEY> production"],
    ["Netlify", "netlify env:set <KEY> <value>"],
    ["Cloudflare", "wrangler secret put <KEY>"],
    ["Fly.io", "fly secrets set <KEY>=<value>"],
  ])("gives %s-specific env var steps", (provider, command) => {
    const prompt = buildPosthogSetupSuggestion("not_installed").prompt ?? "";
    expect(prompt).toContain(provider);
    expect(prompt).toContain(command);
  });

  it.each([
    ["vercel.json", "Vercel"],
    ["netlify.toml", "Netlify"],
    ["wrangler.toml", "Cloudflare"],
    ["fly.toml", "Fly.io"],
  ])("maps the %s marker to %s", (marker, provider) => {
    const prompt = buildPosthogSetupSuggestion("not_installed").prompt ?? "";
    expect(prompt).toContain(`\`${marker}\``);
    expect(prompt).toContain(provider);
  });

  it("falls back to a generic provider when no marker matches", () => {
    const prompt = buildPosthogSetupSuggestion("not_installed").prompt ?? "";
    expect(prompt).toContain('call it "your hosting provider"');
  });
});
