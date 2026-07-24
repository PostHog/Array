import {
  contentToXml,
  type EditorContent,
} from "@posthog/core/message-editor/content";
import type { EditorHandle } from "@posthog/ui/features/message-editor/types";

type ComposerEditor = Pick<EditorHandle, "clear" | "isEmpty" | "setContent">;

export function isSubmittedContentUnchanged(
  content: EditorContent,
  serializedPrompt: string,
): boolean {
  return contentToXml(content) === serializedPrompt;
}

export function shouldSubmitComposerOptimistically(
  isCloudRun: boolean,
  submittedContent: EditorContent | null,
  serializedPrompt: string,
): submittedContent is EditorContent {
  return (
    !isCloudRun &&
    submittedContent !== null &&
    isSubmittedContentUnchanged(submittedContent, serializedPrompt)
  );
}

export async function submitComposerPrompt(
  editor: ComposerEditor,
  submittedContent: EditorContent,
  send: () => Promise<boolean>,
): Promise<void> {
  editor.clear();

  try {
    if (!(await send()) && editor.isEmpty()) {
      editor.setContent(submittedContent);
    }
  } catch (error) {
    if (editor.isEmpty()) {
      editor.setContent(submittedContent);
    }
    throw error;
  }
}
