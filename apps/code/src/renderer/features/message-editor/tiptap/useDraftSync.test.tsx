import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@utils/electronStorage", () => ({
  electronStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  },
}));

import { useDraftStore } from "../stores/draftStore";
import { useDraftSync } from "./useDraftSync";

function DraftAttachmentsProbe({ sessionId }: { sessionId: string }) {
  const { restoredAttachments } = useDraftSync(null, sessionId);
  return (
    <div>
      {restoredAttachments.map((att) => att.label).join(",") || "empty"}
    </div>
  );
}

function RestoreContentProbe({ sessionId }: { sessionId: string }) {
  const { restoreContent } = useDraftSync(null, sessionId);
  return (
    <button
      type="button"
      onClick={() =>
        restoreContent({ segments: [{ type: "text", text: "lost message" }] })
      }
    >
      restore
    </button>
  );
}

describe("useDraftSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useDraftStore.setState((state) => ({
      ...state,
      drafts: {},
      contexts: {},
      commands: {},
      focusRequested: {},
      pendingContent: {},
      _hasHydrated: true,
    }));
  });

  it("clears restored attachments when a draft no longer has attachments", () => {
    const { rerender } = render(
      <DraftAttachmentsProbe sessionId="session-1" />,
    );

    act(() => {
      useDraftStore.getState().actions.setDraft("session-1", {
        segments: [{ type: "text", text: "hello" }],
        attachments: [{ id: "/tmp/file.txt", label: "file.txt" }],
      });
    });

    expect(screen.getByText("file.txt")).toBeInTheDocument();

    act(() => {
      useDraftStore.getState().actions.setDraft("session-1", {
        segments: [{ type: "text", text: "hello" }],
      });
    });

    expect(screen.getByText("empty")).toBeInTheDocument();

    rerender(<DraftAttachmentsProbe sessionId="session-2" />);
    expect(screen.getByText("empty")).toBeInTheDocument();
  });

  it("re-injects content as pending content when restoreContent is called", () => {
    render(<RestoreContentProbe sessionId="session-1" />);

    act(() => {
      screen.getByText("restore").click();
    });

    expect(useDraftStore.getState().pendingContent["session-1"]).toEqual({
      segments: [{ type: "text", text: "lost message" }],
    });
  });
});
