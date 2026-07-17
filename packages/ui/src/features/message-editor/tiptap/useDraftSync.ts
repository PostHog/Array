import {
  type EditorContent,
  type FileAttachment,
  isContentEmpty,
} from "@posthog/core/message-editor/content";
import { useDraftStore } from "@posthog/ui/features/message-editor/draftStore";
import type { Editor, JSONContent } from "@tiptap/core";
import { useCallback, useLayoutEffect, useRef, useState } from "react";

function hasCodeMark(node: JSONContent): boolean {
  return (
    node.type === "text" && !!node.marks?.some((mark) => mark.type === "code")
  );
}

// Markdown code span per CommonMark: content with backticks needs a longer
// delimiter run, and a space pad when it starts or ends with a backtick.
function serializeInlineCode(text: string): string {
  if (!text.includes("`")) return `\`${text}\``;
  const runs = text.match(/`+/g) ?? [];
  const maxRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const delimiter = "`".repeat(maxRun + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${delimiter}${pad}${text}${pad}${delimiter}`;
}

// Markdown fenced block; the fence grows past any backtick run in the code.
function serializeCodeBlock(node: JSONContent): string {
  const text = (node.content ?? [])
    .map((child) => (child.type === "text" ? (child.text ?? "") : ""))
    .join("");
  const runs = text.match(/`+/g) ?? [];
  const maxRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(Math.max(3, maxRun + 1));
  const language =
    typeof node.attrs?.language === "string" ? node.attrs.language : "";
  return `${fence}${language}\n${text}\n${fence}`;
}

export function tiptapJsonToEditorContent(json: JSONContent): EditorContent {
  const segments: EditorContent["segments"] = [];

  const traverse = (node: JSONContent) => {
    if (node.type === "text" && node.text) {
      segments.push({ type: "text", text: node.text });
    } else if (node.type === "hardBreak") {
      // Shift+Enter creates a hard break within a paragraph
      // Use two trailing spaces + newline for markdown line break (<br>)
      segments.push({ type: "text", text: "  \n" });
    } else if (node.type === "mentionChip" && node.attrs) {
      segments.push({
        type: "chip",
        chip: {
          type: node.attrs.type,
          id: node.attrs.id,
          label: node.attrs.label,
          pastedText: node.attrs.pastedText,
          skillPath: node.attrs.skillPath,
          skillSource: node.attrs.skillSource,
          skillName: node.attrs.skillName,
        },
      });
    } else if (node.type === "codeBlock") {
      segments.push({ type: "text", text: serializeCodeBlock(node) });
    } else if (node.type === "doc" && node.content) {
      // Add double newlines between paragraphs for markdown rendering
      // (single newlines in markdown become spaces, double newlines create paragraph breaks)
      for (let i = 0; i < node.content.length; i++) {
        if (i > 0) {
          segments.push({ type: "text", text: "\n\n" });
        }
        traverse(node.content[i]);
      }
    } else if (node.content) {
      const children = node.content;
      for (let i = 0; i < children.length; i++) {
        if (hasCodeMark(children[i])) {
          // Merge adjacent code-marked text nodes so a span the schema split
          // apart serializes as one backticked run.
          let text = children[i].text ?? "";
          while (i + 1 < children.length && hasCodeMark(children[i + 1])) {
            i++;
            text += children[i].text ?? "";
          }
          segments.push({ type: "text", text: serializeInlineCode(text) });
        } else {
          traverse(children[i]);
        }
      }
    }
  };

  traverse(json);
  return { segments };
}

type FencePart =
  | { kind: "text"; text: string }
  | { kind: "code"; language: string; code: string };

// A fence line, its content, and a matching closing fence — anchored to line
// starts so inline backtick runs never match.
const FENCED_BLOCK_REGEX = /(?:^|\n)(`{3,})(\w*)\n([\s\S]*?)\n\1(?=\n|$)/g;

function splitFencedBlocks(text: string): FencePart[] {
  const parts: FencePart[] = [];
  let last = 0;
  for (const match of text.matchAll(FENCED_BLOCK_REGEX)) {
    const index = match.index ?? 0;
    // Drop the "\n\n" block separator the serializer places around fences
    // (the regex already consumed one of the two newlines).
    const before = text.slice(last, index).replace(/\n$/, "");
    if (before) parts.push({ kind: "text", text: before });
    parts.push({ kind: "code", language: match[2], code: match[3] });
    last = index + match[0].length;
  }
  if (last === 0) return [{ kind: "text", text }];
  const rest = text.slice(last).replace(/^\n{1,2}/, "");
  if (rest) parts.push({ kind: "text", text: rest });
  return parts;
}

const INLINE_CODE_REGEX = /`([^`\n]+)`/g;

export interface EditorContentToTiptapJsonOptions {
  /**
   * Parse markdown backtick spans and ``` fences back into `code` marks and
   * `codeBlock` nodes. Gate on the live editor schema
   * (`!!editor.schema.nodes.codeBlock`), not the feature flag, so restoring a
   * stored draft never references node types the editor doesn't have.
   */
  codeBlocks?: boolean;
}

export function editorContentToTiptapJson(
  content: EditorContent,
  options?: EditorContentToTiptapJsonOptions,
): JSONContent {
  const parseCodeBlocks = options?.codeBlocks ?? false;
  const blocks: JSONContent[] = [];
  let currentParagraphContent: JSONContent[] = [];
  // A doc that ends with a code block shouldn't gain a trailing empty
  // paragraph — it would re-serialize with a spurious "\n\n".
  let closedByCodeBlock = false;

  const flushParagraph = () => {
    blocks.push({ type: "paragraph", content: currentParagraphContent });
    currentParagraphContent = [];
    closedByCodeBlock = false;
  };

  const pushLineText = (line: string) => {
    if (!parseCodeBlocks) {
      currentParagraphContent.push({ type: "text", text: line });
      return;
    }
    let last = 0;
    for (const match of line.matchAll(INLINE_CODE_REGEX)) {
      const index = match.index ?? 0;
      if (index > last) {
        currentParagraphContent.push({
          type: "text",
          text: line.slice(last, index),
        });
      }
      currentParagraphContent.push({
        type: "text",
        text: match[1],
        marks: [{ type: "code" }],
      });
      last = index + match[0].length;
    }
    if (last < line.length) {
      currentParagraphContent.push({ type: "text", text: line.slice(last) });
    }
  };

  const pushInlineText = (rawText: string) => {
    // Swallow the "\n\n" block separator that follows a code block — the
    // serializer emits it as its own text segment, and replaying it here
    // would create a spurious empty paragraph.
    const text = closedByCodeBlock ? rawText.replace(/^\n{1,2}/, "") : rawText;
    closedByCodeBlock = false;
    if (!text) return;
    const paragraphParts = text.split("\n\n");
    for (let i = 0; i < paragraphParts.length; i++) {
      if (i > 0) {
        flushParagraph();
      }
      const lineParts = paragraphParts[i].split(/ {2}\n|\n/);
      for (let j = 0; j < lineParts.length; j++) {
        if (j > 0) {
          currentParagraphContent.push({ type: "hardBreak" });
        }
        if (lineParts[j]) {
          pushLineText(lineParts[j]);
        }
      }
    }
  };

  for (const seg of content.segments) {
    if (seg.type === "text") {
      const parts = parseCodeBlocks
        ? splitFencedBlocks(seg.text)
        : [{ kind: "text" as const, text: seg.text }];
      for (const part of parts) {
        if (part.kind === "code") {
          if (currentParagraphContent.length > 0) {
            flushParagraph();
          }
          blocks.push({
            type: "codeBlock",
            attrs: { language: part.language || null },
            content: part.code
              ? [{ type: "text", text: part.code }]
              : undefined,
          });
          closedByCodeBlock = true;
        } else {
          pushInlineText(part.text);
        }
      }
    } else {
      closedByCodeBlock = false;
      currentParagraphContent.push({
        type: "mentionChip",
        attrs: {
          type: seg.chip.type,
          id: seg.chip.id,
          label: seg.chip.label,
          pastedText: seg.chip.pastedText ?? false,
          skillPath: seg.chip.skillPath,
          skillSource: seg.chip.skillSource,
          skillName: seg.chip.skillName,
        },
      });
    }
  }

  if (currentParagraphContent.length > 0 || !closedByCodeBlock) {
    flushParagraph();
  }

  if (blocks.length === 0) {
    blocks.push({ type: "paragraph", content: [] });
  }

  return {
    type: "doc",
    content: blocks,
  };
}

export interface DraftContext {
  taskId?: string;
  repoPath?: string | null;
}

export function useDraftSync(
  editor: Editor | null,
  sessionId: string,
  context?: DraftContext,
) {
  const hasRestoredRef = useRef(false);
  const lastSessionIdRef = useRef(sessionId);
  const lastEditorRef = useRef(editor);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const draftActions = useDraftStore((s) => s.actions);
  const draft = useDraftStore((s) => s.drafts[sessionId] ?? null);
  const pendingContent = useDraftStore(
    (s) => s.pendingContent[sessionId] ?? null,
  );
  const pendingInsert = useDraftStore(
    (s) => s.pendingInsert[sessionId] ?? null,
  );
  const hasHydrated = useDraftStore((s) => s._hasHydrated);

  // Reset restoration flag when sessionId changes (e.g., navigating between tasks)
  if (lastSessionIdRef.current !== sessionId) {
    lastSessionIdRef.current = sessionId;
    hasRestoredRef.current = false;
  }

  // Reset restoration flag when editor instance changes (e.g., when disabled state changes)
  if (lastEditorRef.current !== editor && editor !== null) {
    lastEditorRef.current = editor;
    hasRestoredRef.current = false;
  }

  // Set context for this session
  useLayoutEffect(() => {
    draftActions.setContext(sessionId, {
      taskId: context?.taskId,
      repoPath: context?.repoPath,
    });
    return () => {
      draftActions.removeContext(sessionId);
    };
  }, [sessionId, context?.taskId, context?.repoPath, draftActions]);

  // Restore draft on mount or when sessionId/editor changes
  useLayoutEffect(() => {
    if (!hasHydrated || !editor || hasRestoredRef.current) return;
    if (!draft || isContentEmpty(draft)) return;

    hasRestoredRef.current = true;

    if (typeof draft === "string") {
      editor.commands.setContent(draft);
    } else {
      editor.commands.setContent(
        editorContentToTiptapJson(draft, {
          codeBlocks: !!editor.schema.nodes.codeBlock,
        }),
      );
    }
  }, [hasHydrated, draft, editor]);

  // Handle pending content (e.g., restoring queued messages after cancel)
  useLayoutEffect(() => {
    if (!editor || !pendingContent) return;

    editor.commands.setContent(
      editorContentToTiptapJson(pendingContent, {
        codeBlocks: !!editor.schema.nodes.codeBlock,
      }),
    );
    editor.commands.focus("end", { scrollIntoView: false });
    draftActions.clearPendingContent(sessionId);
  }, [editor, pendingContent, sessionId, draftActions]);

  useLayoutEffect(() => {
    if (!editor || !pendingInsert) return;

    editor.commands.focus("end");
    editor.commands.insertContent(
      editorContentToTiptapJson(pendingInsert, {
        codeBlocks: !!editor.schema.nodes.codeBlock,
      }).content ?? [],
    );
    draftActions.clearPendingInsert(sessionId);
  }, [editor, pendingInsert, sessionId, draftActions]);

  // Extract restored attachments from draft on first restore
  const [restoredAttachments, setRestoredAttachments] = useState<
    FileAttachment[]
  >([]);
  useLayoutEffect(() => {
    if (!draft || typeof draft === "string") return;
    const incoming = draft.attachments ?? [];
    // Short-circuit the common empty→empty case to avoid creating a new array
    // reference that would trigger unnecessary re-renders.
    setRestoredAttachments((prev) =>
      prev.length === 0 && incoming.length === 0 ? prev : incoming,
    );
  }, [draft]);

  const attachmentsRef = useRef<FileAttachment[]>([]);

  const saveDraft = useCallback(
    (e: Editor, attachments?: FileAttachment[]) => {
      // Don't save until store has hydrated from storage
      // This prevents overwriting stored drafts with empty content before restoration
      if (!hasHydrated) return;

      if (attachments !== undefined) {
        attachmentsRef.current = attachments;
      }

      const json = e.getJSON();
      const content = tiptapJsonToEditorContent(json);
      const withAttachments: EditorContent =
        attachmentsRef.current.length > 0
          ? { ...content, attachments: attachmentsRef.current }
          : content;
      draftActions.setDraft(
        sessionId,
        isContentEmpty(withAttachments) ? null : withAttachments,
      );
    },
    [sessionId, draftActions, hasHydrated],
  );

  const clearDraft = useCallback(() => {
    attachmentsRef.current = [];
    draftActions.setDraft(sessionId, null);
  }, [sessionId, draftActions]);

  const getContent = useCallback(
    (attachments?: FileAttachment[]): EditorContent => {
      if (!editorRef.current) return { segments: [] };
      const content = tiptapJsonToEditorContent(editorRef.current.getJSON());
      const atts = attachments ?? attachmentsRef.current;
      return atts.length > 0 ? { ...content, attachments: atts } : content;
    },
    [],
  );

  return {
    saveDraft,
    clearDraft,
    getContent,
    restoredAttachments,
  };
}
