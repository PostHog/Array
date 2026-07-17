import { fireEvent, render, screen } from "@testing-library/react";
import type { NodeViewProps } from "@tiptap/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePasteUndoStore } from "../pasteUndoStore";
import { MentionChipView } from "./MentionChipView";

vi.mock("@posthog/quill", () => ({
  Chip: ({
    children,
    onClick,
  }: React.PropsWithChildren<{ onClick?: () => void }>) => (
    <>
      {children}
      <button type="button" onClick={onClick}>
        Expand pasted text
      </button>
    </>
  ),
}));

vi.mock("@posthog/ui/primitives/Tooltip", () => ({
  Tooltip: ({ children }: React.PropsWithChildren) => children,
}));

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();
  return {
    ...actual,
    NodeViewWrapper: ({ children }: React.PropsWithChildren) => (
      <span>{children}</span>
    ),
  };
});

describe("MentionChipView", () => {
  beforeEach(() => {
    usePasteUndoStore.getState().setUndoableChipId(null);
  });

  it("expands pasted text when the chip is clicked", () => {
    const content = "first line\nsecond line";
    const forgetPastedText = vi.fn();
    const insertText = vi.fn();
    const chain = {
      focus: vi.fn(),
      command: vi.fn(),
      run: vi.fn(),
    };
    chain.focus.mockReturnValue(chain);
    chain.command.mockImplementation(
      (
        callback: (props: { tr: { insertText: typeof insertText } }) => boolean,
      ) => {
        callback({ tr: { insertText } });
        return chain;
      },
    );
    chain.run.mockReturnValue(true);

    render(
      <MentionChipView
        {...({
          node: {
            attrs: {
              type: "file",
              id: "/tmp/pasted.txt",
              label: "Pasted text #1 (2 lines)",
              pastedText: true,
              chipId: "paste-1",
            },
            nodeSize: 1,
          },
          getPos: () => 4,
          editor: { chain: () => chain },
          extension: {
            options: {
              getPastedText: () => content,
              forgetPastedText,
            },
          },
          selected: false,
        } as unknown as NodeViewProps)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Expand pasted text" }));

    expect(insertText).toHaveBeenCalledWith(content, 4, 5);
    expect(chain.run).toHaveBeenCalled();
    expect(forgetPastedText).toHaveBeenCalledWith("paste-1");
  });
});
