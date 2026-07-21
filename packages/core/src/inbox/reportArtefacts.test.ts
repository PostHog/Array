import type { SignalReportArtefactsResponse } from "@posthog/shared/domain-types";
import { describe, expect, it } from "vitest";
import { selectReportRepository } from "./reportArtefacts";

describe("selectReportRepository", () => {
  it.each([
    ["PostHog/Code", "posthog/code"],
    [{ repository: "PostHog/PostHog" }, "posthog/posthog"],
    [{ repo: "PostHog/JS" }, "posthog/js"],
  ])("extracts a repository from %o", (content, expected) => {
    const artefacts = [
      {
        id: "repo",
        type: "repo_selection",
        content,
        created_at: "2026-01-01T00:00:00Z",
      },
    ] as SignalReportArtefactsResponse["results"];

    expect(selectReportRepository(artefacts)).toBe(expected);
  });

  it("returns null without a repository artefact", () => {
    expect(selectReportRepository([])).toBeNull();
  });
});
