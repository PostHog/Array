import type { PostHogAPIClient } from "@posthog/api-client/posthog-client";
import { describe, expect, it, vi } from "vitest";
import type {
  NotebookNodeAIModel,
  NotebookNodeAIModelRequest,
} from "./notebookNodeAIModel";
import {
  buildNotebookNodePropsUpdate,
  extractFirstJsonObject,
  NotebookNodeAIService,
  notebookNodeAICacheKey,
  parseNodeChangeResponse,
} from "./notebookNodeAIService";
import type { NotebookNodeJsonObject } from "./notebookNodeSummary";

function fakeClient(
  overrides: Partial<PostHogAPIClient> = {},
): PostHogAPIClient {
  return overrides as PostHogAPIClient;
}

/** Scripted fake model: returns queued replies in order, records requests. */
function fakeModel(replies: string[]): {
  model: NotebookNodeAIModel;
  requests: NotebookNodeAIModelRequest[];
} {
  const requests: NotebookNodeAIModelRequest[] = [];
  let index = 0;
  return {
    requests,
    model: {
      complete: vi.fn(
        async (
          _client: PostHogAPIClient,
          request: NotebookNodeAIModelRequest,
        ) => {
          requests.push(request);
          const reply = replies[Math.min(index, replies.length - 1)];
          index++;
          if (reply === undefined) throw new Error("no scripted reply");
          request.onText?.(reply);
          return reply;
        },
      ),
    },
  };
}

const TRENDS_PROPS: NotebookNodeJsonObject = {
  query: {
    kind: "InsightVizNode",
    source: {
      kind: "TrendsQuery",
      series: [{ kind: "EventsNode", event: "$pageview" }],
    },
  },
  hideResults: true,
};

describe("NotebookNodeAIService.summarizeNode", () => {
  it("returns the cleaned model text and streams partials", async () => {
    const { model } = fakeModel(['  "Trends of pageviews, last 7 days."  ']);
    const service = new NotebookNodeAIService(model);
    const partials: string[] = [];
    const summary = await service.summarizeNode(
      fakeClient(),
      { tagName: "Query", props: TRENDS_PROPS },
      { onPartial: (text) => partials.push(text) },
    );
    expect(summary).toBe("Trends of pageviews, last 7 days.");
    expect(partials).toEqual(["Trends of pageviews, last 7 days."]);
  });

  it("caches by (tagName + props) so the second call skips the model", async () => {
    const { model } = fakeModel(["A summary."]);
    const service = new NotebookNodeAIService(model);
    const client = fakeClient();
    const input = { tagName: "Query", props: TRENDS_PROPS };
    await service.summarizeNode(client, input);
    const again = await service.summarizeNode(client, input);
    expect(again).toBe("A summary.");
    expect(model.complete).toHaveBeenCalledTimes(1);
    expect(service.getCachedSummary(input)).toBe("A summary.");
  });

  it("ignores shell-managed props in the cache key", () => {
    const withPanels = notebookNodeAICacheKey({
      tagName: "Query",
      props: { ...TRENDS_PROPS, hideFilters: true },
    });
    const withoutPanels = notebookNodeAICacheKey({
      tagName: "Query",
      props: { query: TRENDS_PROPS.query },
    });
    expect(withPanels).toBe(withoutPanels);
  });

  it("enriches entity nodes with the live object and survives fetch failure", async () => {
    const { model, requests } = fakeModel(["Flag summary."]);
    const service = new NotebookNodeAIService(model);
    const getFeatureFlag = vi.fn().mockResolvedValue({
      id: 1,
      key: "my-flag",
      name: "My flag",
      active: true,
      filters: {},
    });
    await service.summarizeNode(fakeClient({ getFeatureFlag }), {
      tagName: "FeatureFlag",
      props: { id: "my-flag" },
    });
    expect(getFeatureFlag).toHaveBeenCalledWith("my-flag");
    expect(requests[0]?.user).toContain('"key":"my-flag"');

    const failing = vi.fn().mockRejectedValue(new Error("403"));
    const summary = await service.summarizeNode(
      fakeClient({ getFeatureFlag: failing }),
      { tagName: "FeatureFlag", props: { id: "other-flag" } },
    );
    expect(summary).toBe("Flag summary.");
  });
});

describe("NotebookNodeAIService.requestNodeChange", () => {
  const change = {
    props: {
      query: {
        kind: "InsightVizNode",
        source: {
          kind: "TrendsQuery",
          series: [{ kind: "EventsNode", event: "$pageview" }],
          trendsFilter: { display: "ActionsBar" },
        },
      },
    },
    summary: "Trends bar chart of pageviews.",
  };

  it("applies a change from one model call and preserves shell props", async () => {
    const { model, requests } = fakeModel([
      `Here you go:\n\`\`\`json\n${JSON.stringify(change)}\n\`\`\``,
    ]);
    const service = new NotebookNodeAIService(model);
    const result = await service.requestNodeChange(
      fakeClient(),
      { tagName: "Query", props: TRENDS_PROPS },
      "make it a bar chart",
    );
    expect(model.complete).toHaveBeenCalledTimes(1);
    expect(result.summary).toBe("Trends bar chart of pageviews.");
    expect(result.props.hideResults).toBe(true);
    expect(result.props.query).toEqual(change.props.query);
    // The new summary is primed so reopening the node is instant.
    expect(
      service.getCachedSummary({ tagName: "Query", props: result.props }),
    ).toBe("Trends bar chart of pageviews.");
    // Shell props stay out of the prompt.
    expect(requests[0]?.user).not.toContain("hideResults");
  });

  it.each([
    ["prose with no JSON", "Sorry, I cannot help with that."],
    ["unparsable JSON", '{"props": {"query": }}'],
    ["missing summary", '{"props": {"query": {"kind": "TrendsQuery"}}}'],
    ["query without kind", '{"props": {"query": {}}, "summary": "x"}'],
  ])("retries once after %s, then succeeds", async (_label, badReply) => {
    const { model, requests } = fakeModel([badReply, JSON.stringify(change)]);
    const service = new NotebookNodeAIService(model);
    const result = await service.requestNodeChange(
      fakeClient(),
      { tagName: "Query", props: TRENDS_PROPS },
      "make it a bar chart",
    );
    expect(model.complete).toHaveBeenCalledTimes(2);
    expect(requests[1]?.user).toContain("could not be applied");
    expect(result.summary).toBe("Trends bar chart of pageviews.");
  });

  it("throws after two unusable replies", async () => {
    const { model } = fakeModel(["nope", "still nope"]);
    const service = new NotebookNodeAIService(model);
    await expect(
      service.requestNodeChange(
        fakeClient(),
        { tagName: "Query", props: TRENDS_PROPS },
        "do a thing",
      ),
    ).rejects.toThrow(/no JSON object/);
    expect(model.complete).toHaveBeenCalledTimes(2);
  });
});

describe("buildNotebookNodePropsUpdate", () => {
  it("replaces, deletes dropped keys, and never touches shell props", () => {
    const current: NotebookNodeJsonObject = {
      query: { kind: "HogQLQuery", query: "SELECT 1" },
      title: "Old",
      stale: "remove-me",
      hideFilters: true,
    };
    const next: NotebookNodeJsonObject = {
      query: { kind: "HogQLQuery", query: "SELECT 2" },
      title: "New",
    };
    expect(buildNotebookNodePropsUpdate(current, next)).toEqual({
      query: { kind: "HogQLQuery", query: "SELECT 2" },
      title: "New",
      stale: undefined,
    });
  });
});

describe("parse helpers", () => {
  it.each([
    ['{"a": 1}', '{"a": 1}'],
    ['pre {"a": {"b": "}"}} post', '{"a": {"b": "}"}}'],
    ['```json\n{"a": 1}\n```', '{"a": 1}'],
    ["no braces here", null],
    ['{"unbalanced": ', null],
  ])("extractFirstJsonObject(%j) -> %j", (input, expected) => {
    expect(extractFirstJsonObject(input)).toBe(expected);
  });

  it("rejects a non-object props payload", () => {
    const outcome = parseNodeChangeResponse(
      "Query",
      '{"props": [1, 2], "summary": "x"}',
    );
    expect(outcome.ok).toBe(false);
  });
});
