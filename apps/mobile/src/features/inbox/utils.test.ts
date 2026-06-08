import { describe, expect, it } from "vitest";
import type {
  AvailableSuggestedReviewer,
  SignalReport,
  SignalReportStatus,
  SuggestedReviewer,
} from "./types";
import {
  buildInboxViewedProperties,
  buildReviewerOptions,
  reviewerMatchesAvailable,
  toSuggestedReviewerWriteContent,
} from "./utils";

function makeReviewer(
  partial: Partial<SuggestedReviewer> = {},
): SuggestedReviewer {
  return {
    github_login: "octocat",
    github_name: "The Octocat",
    relevant_commits: [],
    user: null,
    ...partial,
  };
}

function makeAvailable(
  partial: Partial<AvailableSuggestedReviewer> = {},
): AvailableSuggestedReviewer {
  return {
    uuid: "uuid-1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    github_login: "ada",
    ...partial,
  };
}

const DEFAULT_STATUS_FILTER: SignalReportStatus[] = [
  "ready",
  "pending_input",
  "in_progress",
  "failed",
  "candidate",
  "potential",
];

function makeReport(
  partial: Partial<SignalReport> & Pick<SignalReport, "id">,
): SignalReport {
  return {
    title: null,
    summary: null,
    status: "ready",
    total_weight: 0,
    signal_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    artefact_count: 0,
    ...partial,
  };
}

describe("buildInboxViewedProperties", () => {
  it("emits zero counts for an empty list", () => {
    const props = buildInboxViewedProperties([], 0, {
      sourceProductFilter: [],
      statusFilter: DEFAULT_STATUS_FILTER,
      suggestedReviewerFilter: [],
      defaultStatusFilter: DEFAULT_STATUS_FILTER,
    });
    expect(props).toMatchObject({
      report_count: 0,
      total_count: 0,
      ready_count: 0,
      has_active_filters: false,
      is_empty: true,
      priority_p0_count: 0,
      priority_p1_count: 0,
      priority_p2_count: 0,
      priority_p3_count: 0,
      priority_p4_count: 0,
      priority_unknown_count: 0,
      actionability_immediately_actionable_count: 0,
      actionability_requires_human_input_count: 0,
      actionability_not_actionable_count: 0,
      actionability_unknown_count: 0,
    });
  });

  it("breaks visible reports down by priority and actionability", () => {
    const reports: SignalReport[] = [
      makeReport({
        id: "1",
        priority: "P0",
        actionability: "immediately_actionable",
        status: "ready",
      }),
      makeReport({
        id: "2",
        priority: "P2",
        actionability: "requires_human_input",
        status: "ready",
      }),
      makeReport({
        id: "3",
        priority: "P2",
        actionability: "not_actionable",
        status: "potential",
      }),
      makeReport({ id: "4", status: "failed" }),
    ];

    const props = buildInboxViewedProperties(reports, 4, {
      sourceProductFilter: [],
      statusFilter: DEFAULT_STATUS_FILTER,
      suggestedReviewerFilter: [],
      defaultStatusFilter: DEFAULT_STATUS_FILTER,
    });

    expect(props.report_count).toBe(4);
    expect(props.total_count).toBe(4);
    expect(props.ready_count).toBe(2);
    expect(props.priority_p0_count).toBe(1);
    expect(props.priority_p2_count).toBe(2);
    expect(props.priority_unknown_count).toBe(1);
    expect(props.actionability_immediately_actionable_count).toBe(1);
    expect(props.actionability_requires_human_input_count).toBe(1);
    expect(props.actionability_not_actionable_count).toBe(1);
    expect(props.actionability_unknown_count).toBe(1);
  });

  it("marks filters active when any of status/source/reviewer differs from defaults", () => {
    const narrowed = buildInboxViewedProperties([], 0, {
      sourceProductFilter: [],
      statusFilter: ["ready"],
      suggestedReviewerFilter: [],
      defaultStatusFilter: DEFAULT_STATUS_FILTER,
    });
    expect(narrowed.has_active_filters).toBe(true);
    expect(narrowed.status_filter_count).toBe(1);

    const sourced = buildInboxViewedProperties([], 0, {
      sourceProductFilter: ["error_tracking"],
      statusFilter: DEFAULT_STATUS_FILTER,
      suggestedReviewerFilter: [],
      defaultStatusFilter: DEFAULT_STATUS_FILTER,
    });
    expect(sourced.has_active_filters).toBe(true);
    expect(sourced.source_product_filter).toEqual(["error_tracking"]);

    const reviewer = buildInboxViewedProperties([], 0, {
      sourceProductFilter: [],
      statusFilter: DEFAULT_STATUS_FILTER,
      suggestedReviewerFilter: ["uuid-1"],
      defaultStatusFilter: DEFAULT_STATUS_FILTER,
    });
    expect(reviewer.has_active_filters).toBe(true);
  });

  it("treats a reordered default status set as not filtered", () => {
    const props = buildInboxViewedProperties([], 0, {
      sourceProductFilter: [],
      statusFilter: [...DEFAULT_STATUS_FILTER].reverse(),
      suggestedReviewerFilter: [],
      defaultStatusFilter: DEFAULT_STATUS_FILTER,
    });
    expect(props.has_active_filters).toBe(false);
  });
});

describe("toSuggestedReviewerWriteContent", () => {
  it.each([
    {
      name: "prefers github_login so the server preserves commits/name",
      reviewer: makeReviewer({
        github_login: "ada",
        user: { id: 1, uuid: "u1", email: "", first_name: "", last_name: "" },
      }),
      expected: [{ github_login: "ada" }],
    },
    {
      name: "falls back to user_uuid when there is no github_login",
      reviewer: makeReviewer({
        github_login: "",
        user: { id: 1, uuid: "u1", email: "", first_name: "", last_name: "" },
      }),
      expected: [{ user_uuid: "u1" }],
    },
    {
      name: "drops entries with neither a login nor a resolved user",
      reviewer: makeReviewer({ github_login: "", user: null }),
      expected: [],
    },
  ])("$name", ({ reviewer, expected }) => {
    expect(toSuggestedReviewerWriteContent([reviewer])).toEqual(expected);
  });
});

describe("reviewerMatchesAvailable", () => {
  it.each([
    {
      name: "matches on user uuid",
      reviewer: makeReviewer({
        github_login: "",
        user: {
          id: 1,
          uuid: "uuid-1",
          email: "",
          first_name: "",
          last_name: "",
        },
      }),
      expected: true,
    },
    {
      name: "matches on case-insensitive github login",
      reviewer: makeReviewer({ github_login: "ADA", user: null }),
      expected: true,
    },
    {
      name: "does not match different people",
      reviewer: makeReviewer({ github_login: "octocat", user: null }),
      expected: false,
    },
  ])("$name", ({ reviewer, expected }) => {
    expect(reviewerMatchesAvailable(reviewer, makeAvailable())).toBe(expected);
  });
});

describe("buildReviewerOptions", () => {
  it("dedupes by uuid and pins the current user first", () => {
    const options = buildReviewerOptions(
      [
        makeAvailable({ uuid: "b", name: "Bob" }),
        makeAvailable({ uuid: "a", name: "Ada" }),
        makeAvailable({ uuid: "a", name: "Ada (dupe)" }),
      ],
      "b",
    );
    expect(options.map((o) => o.uuid)).toEqual(["b", "a"]);
    expect(options[0].isMe).toBe(true);
  });
});
