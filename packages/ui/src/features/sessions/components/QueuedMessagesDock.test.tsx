import { Theme } from "@radix-ui/themes";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queuedState = vi.hoisted(() => ({
  messages: [] as Array<{ id: string; content: string; queuedAt: number }>,
}));

vi.mock("@posthog/core/sessions/sessionService", () => ({
  SESSION_SERVICE: Symbol.for("test.session-service"),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => ({
    steerQueuedMessage: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@posthog/ui/features/sessions/useSession", () => ({
  useQueuedMessagesForTask: () => queuedState.messages,
}));

vi.mock("@posthog/ui/features/sessions/hooks/useMessagingMode", () => ({
  useSupportsNativeSteer: () => false,
}));

vi.mock(
  "@posthog/ui/features/sessions/hooks/useReturnQueuedMessageToEditor",
  () => ({
    useReturnQueuedMessageToEditor: () => vi.fn(),
  }),
);

vi.mock("@posthog/ui/features/sessions/sessionStore", () => ({
  sessionStoreSetters: { removeQueuedMessage: vi.fn() },
  useSessionIsCloud: () => false,
  useSessionSelector: <T,>(
    _taskId: string,
    select: (session: undefined) => T,
  ) => select(undefined),
}));

vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: vi.fn() },
}));

// Stub the per-message card so the test exercises the dock's collapse/scroll
// shell, not the markdown/steer internals it already owns.
vi.mock(
  "@posthog/ui/features/sessions/components/session-update/QueuedMessageView",
  async () => {
    const React = await import("react");
    return {
      QueuedMessageView: ({ message }: { message: { content: string } }) =>
        React.createElement(
          "div",
          { "data-testid": "queued-card" },
          message.content,
        ),
    };
  },
);

import { QueuedMessagesDock } from "./QueuedMessagesDock";

const TWO_MESSAGES = [
  { id: "q1", content: "first queued message", queuedAt: 1 },
  { id: "q2", content: "second queued message", queuedAt: 2 },
];

// Each test uses a distinct taskId so the (real, per-task) collapse state in
// sessionViewStore never bleeds between cases.
function renderDock(taskId: string) {
  return render(
    <Theme>
      <QueuedMessagesDock taskId={taskId} />
    </Theme>,
  );
}

describe("QueuedMessagesDock", () => {
  beforeEach(() => {
    queuedState.messages = [];
  });

  it("renders nothing when the queue is empty", () => {
    queuedState.messages = [];
    const { container } = render(<QueuedMessagesDock taskId="task-empty" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("is expanded by default and shows every queued message with a count", () => {
    queuedState.messages = TWO_MESSAGES;
    renderDock("task-expanded");

    expect(screen.getByText("first queued message")).toBeInTheDocument();
    expect(screen.getByText("second queued message")).toBeInTheDocument();
    expect(screen.getByText("2 queued")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Collapse queued messages" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("caps the list height and scrolls so it can't push the composer down", () => {
    queuedState.messages = TWO_MESSAGES;
    const { container } = renderDock("task-scroll");

    const scroller = container.querySelector(".overflow-y-auto");
    expect(scroller).not.toBeNull();
    expect(scroller?.classList.contains("max-h-[30vh]")).toBe(true);
  });

  it("collapses and expands the list when the header is toggled", () => {
    queuedState.messages = TWO_MESSAGES;
    renderDock("task-toggle");

    expect(screen.getAllByTestId("queued-card")).toHaveLength(2);

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse queued messages" }),
    );

    // Collapsed: cards are hidden, but the header with the live count stays.
    expect(screen.queryAllByTestId("queued-card")).toHaveLength(0);
    expect(screen.getByText("2 queued")).toBeInTheDocument();
    const trigger = screen.getByRole("button", {
      name: "Expand queued messages",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    expect(screen.getAllByTestId("queued-card")).toHaveLength(2);
  });
});
