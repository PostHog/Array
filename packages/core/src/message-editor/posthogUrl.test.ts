import { describe, expect, it } from "vitest";
import { type ParsedPostHogUrl, parsePostHogUrl } from "./posthogUrl";

describe("parsePostHogUrl", () => {
  const accepts: Array<{
    name: string;
    input: string;
    expected: ParsedPostHogUrl;
  }> = [
    // --- Long format: /project/{id}/... ---
    {
      name: "US cloud feature flag (long)",
      input: "https://us.posthog.com/project/1/feature_flags/42",
      expected: {
        resourceType: "feature_flag",
        projectId: "1",
        resourceId: "42",
        normalizedUrl: "https://us.posthog.com/project/1/feature_flags/42",
        label: "Feature Flag #42",
      },
    },
    {
      name: "EU cloud experiment (long)",
      input: "https://eu.posthog.com/project/99/experiments/7",
      expected: {
        resourceType: "experiment",
        projectId: "99",
        resourceId: "7",
        normalizedUrl: "https://eu.posthog.com/project/99/experiments/7",
        label: "Experiment #7",
      },
    },
    {
      name: "localhost insight with alphanumeric ID",
      input: "http://localhost:8010/project/1/insights/abc123",
      expected: {
        resourceType: "insight",
        projectId: "1",
        resourceId: "abc123",
        normalizedUrl: "http://localhost:8010/project/1/insights/abc123",
        label: "Insight abc123",
      },
    },
    {
      name: "dashboard (long)",
      input: "https://us.posthog.com/project/5/dashboard/10",
      expected: {
        resourceType: "dashboard",
        projectId: "5",
        resourceId: "10",
        normalizedUrl: "https://us.posthog.com/project/5/dashboard/10",
        label: "Dashboard #10",
      },
    },
    {
      name: "error tracking (long)",
      input: "https://us.posthog.com/project/1/error_tracking/abc-def-123",
      expected: {
        resourceType: "error_tracking",
        projectId: "1",
        resourceId: "abc-def-123",
        normalizedUrl:
          "https://us.posthog.com/project/1/error_tracking/abc-def-123",
        label: "Error abc-def-123",
      },
    },
    {
      name: "recording (replay, long)",
      input: "https://eu.posthog.com/project/2/replay/019012ab-cd34-ef56",
      expected: {
        resourceType: "recording",
        projectId: "2",
        resourceId: "019012ab-cd34-ef56",
        normalizedUrl:
          "https://eu.posthog.com/project/2/replay/019012ab-cd34-ef56",
        label: "Recording 019012ab-cd34-ef56",
      },
    },
    {
      name: "trailing slash is stripped",
      input: "https://us.posthog.com/project/1/feature_flags/42/",
      expected: {
        resourceType: "feature_flag",
        projectId: "1",
        resourceId: "42",
        normalizedUrl: "https://us.posthog.com/project/1/feature_flags/42",
        label: "Feature Flag #42",
      },
    },
    {
      name: "query params are stripped",
      input: "https://us.posthog.com/project/1/experiments/3?tab=results",
      expected: {
        resourceType: "experiment",
        projectId: "1",
        resourceId: "3",
        normalizedUrl: "https://us.posthog.com/project/1/experiments/3",
        label: "Experiment #3",
      },
    },
    {
      name: "fragment is stripped",
      input: "https://us.posthog.com/project/1/dashboard/5#section",
      expected: {
        resourceType: "dashboard",
        projectId: "1",
        resourceId: "5",
        normalizedUrl: "https://us.posthog.com/project/1/dashboard/5",
        label: "Dashboard #5",
      },
    },
    {
      name: "surrounding whitespace",
      input: "  https://us.posthog.com/project/1/feature_flags/42  \n",
      expected: {
        resourceType: "feature_flag",
        projectId: "1",
        resourceId: "42",
        normalizedUrl: "https://us.posthog.com/project/1/feature_flags/42",
        label: "Feature Flag #42",
      },
    },

    // --- Short format (no /project/{id}/) ---
    {
      name: "short feature flag",
      input: "https://us.posthog.com/feature_flags/619272",
      expected: {
        resourceType: "feature_flag",
        projectId: "",
        resourceId: "619272",
        normalizedUrl: "https://us.posthog.com/feature_flags/619272",
        label: "Feature Flag #619272",
      },
    },
    {
      name: "short experiment",
      input: "https://us.posthog.com/experiments/373424",
      expected: {
        resourceType: "experiment",
        projectId: "",
        resourceId: "373424",
        normalizedUrl: "https://us.posthog.com/experiments/373424",
        label: "Experiment #373424",
      },
    },
    {
      name: "short insight (alphanumeric ID)",
      input: "https://us.posthog.com/insights/KP8iqi6E",
      expected: {
        resourceType: "insight",
        projectId: "",
        resourceId: "KP8iqi6E",
        normalizedUrl: "https://us.posthog.com/insights/KP8iqi6E",
        label: "Insight KP8iqi6E",
      },
    },
    {
      name: "short dashboard",
      input: "https://us.posthog.com/dashboard/944836",
      expected: {
        resourceType: "dashboard",
        projectId: "",
        resourceId: "944836",
        normalizedUrl: "https://us.posthog.com/dashboard/944836",
        label: "Dashboard #944836",
      },
    },

    // --- New resource types ---
    {
      name: "survey (short, UUID)",
      input:
        "https://us.posthog.com/surveys/019d1c79-170c-0000-b8dc-6880403ecae9",
      expected: {
        resourceType: "survey",
        projectId: "",
        resourceId: "019d1c79-170c-0000-b8dc-6880403ecae9",
        normalizedUrl:
          "https://us.posthog.com/surveys/019d1c79-170c-0000-b8dc-6880403ecae9",
        label: "Survey 019d1c79-170c-0000-b8dc-6880403ecae9",
      },
    },
    {
      name: "notebook (short)",
      input: "https://us.posthog.com/notebooks/wkGd",
      expected: {
        resourceType: "notebook",
        projectId: "",
        resourceId: "wkGd",
        normalizedUrl: "https://us.posthog.com/notebooks/wkGd",
        label: "Notebook wkGd",
      },
    },
    {
      name: "cohort (long)",
      input: "https://us.posthog.com/project/1/cohorts/55",
      expected: {
        resourceType: "cohort",
        projectId: "1",
        resourceId: "55",
        normalizedUrl: "https://us.posthog.com/project/1/cohorts/55",
        label: "Cohort #55",
      },
    },
    {
      name: "action (nested path, long)",
      input: "https://us.posthog.com/project/1/data-management/actions/99",
      expected: {
        resourceType: "action",
        projectId: "1",
        resourceId: "99",
        normalizedUrl:
          "https://us.posthog.com/project/1/data-management/actions/99",
        label: "Action #99",
      },
    },
    {
      name: "action (nested path, short)",
      input: "https://us.posthog.com/data-management/actions/99",
      expected: {
        resourceType: "action",
        projectId: "",
        resourceId: "99",
        normalizedUrl: "https://us.posthog.com/data-management/actions/99",
        label: "Action #99",
      },
    },
    {
      name: "early access feature (long)",
      input:
        "https://us.posthog.com/project/1/early_access_features/abc-123-def",
      expected: {
        resourceType: "early_access_feature",
        projectId: "1",
        resourceId: "abc-123-def",
        normalizedUrl:
          "https://us.posthog.com/project/1/early_access_features/abc-123-def",
        label: "Early Access Feature abc-123-def",
      },
    },
    {
      name: "survey (long)",
      input:
        "https://us.posthog.com/project/1/surveys/019d1c79-170c-0000-b8dc-6880403ecae9",
      expected: {
        resourceType: "survey",
        projectId: "1",
        resourceId: "019d1c79-170c-0000-b8dc-6880403ecae9",
        normalizedUrl:
          "https://us.posthog.com/project/1/surveys/019d1c79-170c-0000-b8dc-6880403ecae9",
        label: "Survey 019d1c79-170c-0000-b8dc-6880403ecae9",
      },
    },

    // --- Person ---
    {
      name: "person (short)",
      input: "https://us.posthog.com/persons/user_abc123",
      expected: {
        resourceType: "person",
        projectId: "",
        resourceId: "user_abc123",
        normalizedUrl: "https://us.posthog.com/persons/user_abc123",
        label: "Person user_abc123",
      },
    },
    {
      name: "person (long)",
      input: "https://us.posthog.com/project/1/persons/user_abc123",
      expected: {
        resourceType: "person",
        projectId: "1",
        resourceId: "user_abc123",
        normalizedUrl: "https://us.posthog.com/project/1/persons/user_abc123",
        label: "Person user_abc123",
      },
    },

    // --- Group (compound ID: type-index/group-key) ---
    {
      name: "group (short)",
      input: "https://us.posthog.com/groups/0/my-company-name",
      expected: {
        resourceType: "group",
        projectId: "",
        resourceId: "0/my-company-name",
        normalizedUrl: "https://us.posthog.com/groups/0/my-company-name",
        label: "Group 0/my-company-name",
      },
    },
    {
      name: "group (long)",
      input: "https://us.posthog.com/project/1/groups/0/my-company-name",
      expected: {
        resourceType: "group",
        projectId: "1",
        resourceId: "0/my-company-name",
        normalizedUrl:
          "https://us.posthog.com/project/1/groups/0/my-company-name",
        label: "Group 0/my-company-name",
      },
    },
    {
      name: "group with numeric key",
      input: "https://eu.posthog.com/groups/1/12345",
      expected: {
        resourceType: "group",
        projectId: "",
        resourceId: "1/12345",
        normalizedUrl: "https://eu.posthog.com/groups/1/12345",
        label: "Group 1/12345",
      },
    },
  ];

  it.each(accepts)("accepts $name", ({ input, expected }) => {
    expect(parsePostHogUrl(input)).toEqual(expected);
  });

  const rejects: Array<{ name: string; input: string }> = [
    {
      name: "non-PostHog host",
      input: "https://example.com/project/1/feature_flags/42",
    },
    { name: "github URL", input: "https://github.com/PostHog/code/issues/1" },
    { name: "non-URL text", input: "not a url" },
    { name: "empty string", input: "" },
    {
      name: "search/filter URL without resource ID",
      input: "https://us.posthog.com/project/1/feature_flags?search=my-flag",
    },
    {
      name: "org-level billing URL",
      input: "https://us.posthog.com/organization/billing/overview",
    },
    {
      name: "feature flags index without ID (long)",
      input: "https://us.posthog.com/project/1/feature_flags",
    },
    {
      name: "unknown resource type",
      input: "https://us.posthog.com/project/1/unknown_thing/42",
    },
    {
      name: "bare host with no path",
      input: "https://us.posthog.com/",
    },
    {
      name: "single segment (not a resource detail)",
      input: "https://us.posthog.com/feature_flags",
    },
    {
      name: "groups with only type index (missing group key)",
      input: "https://us.posthog.com/groups/0",
    },
  ];

  it.each(rejects)("rejects $name", ({ input }) => {
    expect(parsePostHogUrl(input)).toBeNull();
  });
});
