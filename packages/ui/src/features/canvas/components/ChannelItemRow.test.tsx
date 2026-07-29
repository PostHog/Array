import type { ChannelItemModel } from "@posthog/core/canvas/channelItems";
import { formatRelativeTimeShort } from "@posthog/shared";
import type { TaskStatusInput } from "@posthog/ui/features/sidebar/components/items/taskStatusVocabulary";
import { Theme } from "@radix-ui/themes";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The row's status comes from live session/workspace state and a per-task tRPC
// query, none of which a unit test has. Stubbed at the module boundary, as
// ChannelSidebar.test.tsx does for the same reason.
const mocks = vi.hoisted(() => ({ status: null as TaskStatusInput | null }));
vi.mock("@posthog/ui/features/canvas/hooks/useChannelTaskStatus", () => ({
  useChannelTaskStatus: () => mocks.status,
}));

import { ChannelItemRow } from "./ChannelItemRow";

const actions = {
  open: () => {},
  togglePin: () => {},
  archive: () => {},
};

function item(overrides: Partial<ChannelItemModel> = {}): ChannelItemModel {
  return {
    key: "task:task-1",
    kind: "task",
    id: "task-1",
    title: "Investigate signup drop-off",
    ts: Date.parse("2026-07-17T12:00:00.000Z"),
    pinned: false,
    rawStatus: null,
    authorUser: null,
    authorName: null,
    authorUuid: "user-uuid",
    templateId: null,
    task: null,
    ...overrides,
  };
}

function renderRow(model: ChannelItemModel) {
  return render(
    <Theme>
      <ChannelItemRow actions={actions} isActive={false} item={model} />
    </Theme>,
  );
}

beforeEach(() => {
  mocks.status = null;
});

describe("ChannelItemRow", () => {
  // The dot vocabulary in one table: what the row's leading mark says for each
  // state a task can be in. Only the states a reader can act on get a voice —
  // run mechanics (queued, failed) resolve to "working" or "something to read".
  it.each([
    [
      "a permission prompt",
      { needsPermission: true },
      "Needs permission — blocked on you",
    ],
    ["a streaming agent", { isGenerating: true }, "Working"],
    [
      "a cloud run in flight",
      { taskRunStatus: "in_progress" as const },
      "Working",
    ],
    ["a queued cloud run", { taskRunStatus: "queued" as const }, "Working"],
    [
      "a broken run with unseen output",
      { taskRunStatus: "failed" as const, isUnread: true },
      "Unread — something to read",
    ],
    ["a suspended task", { isSuspended: true }, "Suspended — parked"],
    [
      // The cloud workflow holds a run at in_progress while it babysits CI after
      // opening the PR; under a merge queue that wait can outlast the agent by
      // hours, so the PR's existence has to win over the run's claim.
      "a run still babysitting CI behind an open PR",
      { taskRunStatus: "in_progress" as const, prState: "open" as const },
      "Nothing owed to you",
    ],
    [
      "a run whose PR url is known but state isn't",
      {
        taskRunStatus: "in_progress" as const,
        prUrl: "https://github.com/PostHog/code/pull/1",
      },
      "Nothing owed to you",
    ],
    [
      // A live local session is the agent typing right now, which no PR overrides.
      "a streaming agent that already has a PR",
      { isGenerating: true, prState: "open" as const },
      "Working",
    ],
    [
      "a merged PR",
      { prState: "merged" as const },
      // PR state lives on the badge, so the dot stays quiet.
      "Nothing owed to you",
    ],
    ["an idle task", {}, "Nothing owed to you"],
  ])("labels %s", (_case, status: TaskStatusInput, label) => {
    mocks.status = status;

    renderRow(item());

    expect(screen.getByRole("img", { name: label })).not.toBeNull();
  });

  it("badges a PR it can see the url of but not the state of", () => {
    mocks.status = {
      workspaceMode: "cloud",
      prUrl: "https://github.com/PostHog/code/pull/1",
    };

    renderRow(item());

    // Uncoloured, because colour is a verdict — but present, because a task that
    // opened a PR must not look like it did nothing.
    expect(screen.getByRole("img", { name: "Pull request" })).not.toBeNull();
  });

  it("shows a task's badges instead of its timestamp", () => {
    mocks.status = { workspaceMode: "cloud", prState: "merged" };

    renderRow(item());

    expect(screen.getByRole("img", { name: "Cloud run" })).not.toBeNull();
    expect(screen.getByRole("img", { name: "Merged" })).not.toBeNull();
    expect(screen.queryByText(formatRelativeTimeShort(item().ts))).toBeNull();
  });

  it("leaves a canvas its template glyph and timestamp, having no run", () => {
    renderRow(
      item({
        key: "canvas:canvas-1",
        kind: "canvas",
        id: "canvas-1",
        title: "Web analytics overview",
        templateId: "web-analytics",
      }),
    );

    expect(
      screen.queryByRole("img", { name: "Nothing owed to you" }),
    ).toBeNull();
    expect(screen.getByText(formatRelativeTimeShort(item().ts))).not.toBeNull();
  });

  it("opens the task context menu from the row", () => {
    const onContextMenu = vi.fn();

    render(
      <Theme>
        <ChannelItemRow
          actions={actions}
          isActive={false}
          item={item()}
          onContextMenu={onContextMenu}
        />
      </Theme>,
    );

    fireEvent.contextMenu(screen.getByText("Investigate signup drop-off"));

    expect(onContextMenu).toHaveBeenCalledOnce();
  });
});
