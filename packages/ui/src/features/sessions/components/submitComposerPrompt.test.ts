import type { EditorContent } from "@posthog/core/message-editor/content";
import { expect, it, vi } from "vitest";
import {
  shouldSubmitComposerOptimistically,
  submitComposerPrompt,
} from "./submitComposerPrompt";

function createEditor() {
  return {
    clear: vi.fn(),
    isEmpty: vi.fn(() => true),
    setContent: vi.fn(),
  };
}

const content: EditorContent = {
  segments: [{ type: "text", text: "queued message" }],
};

it("uses optimistic submission when the composer still matches", () => {
  expect(shouldSubmitComposerOptimistically(content, "queued message")).toBe(
    true,
  );
});

it("clears the submitted message before sending completes", async () => {
  const editor = createEditor();
  let finishSending: ((sent: boolean) => void) | undefined;
  const send = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finishSending = resolve;
      }),
  );

  const submission = submitComposerPrompt(editor, content, send);

  expect(editor.clear).toHaveBeenCalledOnce();
  finishSending?.(true);
  await submission;
});

it("restores a failed message when the composer is still empty", async () => {
  const editor = createEditor();

  await submitComposerPrompt(editor, content, async () => false);

  expect(editor.setContent).toHaveBeenCalledWith(content);
});

it("does not overwrite a new draft when an earlier message fails", async () => {
  const editor = createEditor();
  editor.isEmpty.mockReturnValue(false);

  await submitComposerPrompt(editor, content, async () => false);

  expect(editor.setContent).not.toHaveBeenCalled();
});
