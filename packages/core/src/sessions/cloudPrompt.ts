import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  buildCloudTaskDescription,
  getAbsoluteAttachmentPaths,
  stripAbsoluteFileTags,
} from "@posthog/core/editor/cloud-prompt";
import type { EditorContent } from "@posthog/core/message-editor/content";
import { getFileName, pathToFileUri } from "@posthog/shared";

const FILE_URI_PREFIX = "file://";

export interface CloudPromptTransport {
  filePaths: string[];
  messageText?: string;
  promptText: string;
}

export type QueuedCloudPrompt = string | ContentBlock[];

function decodeFileUri(uri: string): string | null {
  if (!uri.startsWith(FILE_URI_PREFIX)) {
    return null;
  }

  const encodedPath = uri.slice(FILE_URI_PREFIX.length);
  const normalizedPath = encodedPath.startsWith("/")
    ? encodedPath
    : `/${encodedPath}`;

  try {
    return normalizedPath
      .split("/")
      .map((segment, index) =>
        index === 0 && segment === "" ? segment : decodeURIComponent(segment),
      )
      .join("/");
  } catch {
    return null;
  }
}

function collectBlockAttachmentPaths(prompt: ContentBlock[]): string[] {
  const filePaths = prompt
    .map((block) => {
      if (block.type === "resource_link") {
        return decodeFileUri(block.uri);
      }

      if (block.type === "resource") {
        return block.resource.uri ? decodeFileUri(block.resource.uri) : null;
      }

      if (block.type === "image") {
        return block.uri ? decodeFileUri(block.uri) : null;
      }

      return null;
    })
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(filePaths));
}

function summarizePrompt(text: string, filePaths: string[]): string {
  if (filePaths.length === 0) {
    return text.trim();
  }

  const attachmentSummary = `Attached files: ${filePaths.map(getFileName).join(", ")}`;
  return text.trim()
    ? `${text.trim()}\n\n${attachmentSummary}`
    : attachmentSummary;
}

export function getCloudPromptTransport(
  prompt: string | ContentBlock[],
  filePaths: string[] = [],
): CloudPromptTransport {
  if (typeof prompt === "string") {
    const attachmentPaths = getAbsoluteAttachmentPaths(prompt, filePaths);
    const messageText = stripAbsoluteFileTags(prompt).trim();

    return {
      filePaths: attachmentPaths,
      messageText: messageText || undefined,
      promptText: buildCloudTaskDescription(prompt, filePaths).trim(),
    };
  }

  const promptText = prompt
    .filter(
      (block): block is Extract<ContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("")
    .trim();
  const attachmentPaths = collectBlockAttachmentPaths(prompt);

  return {
    filePaths: attachmentPaths,
    messageText: promptText || undefined,
    promptText: summarizePrompt(promptText, attachmentPaths),
  };
}

export function cloudPromptToBlocks(prompt: QueuedCloudPrompt): ContentBlock[] {
  if (typeof prompt !== "string") {
    return prompt;
  }

  const transport = getCloudPromptTransport(prompt);
  const blocks: ContentBlock[] = [];

  if (transport.messageText) {
    blocks.push({ type: "text", text: transport.messageText });
  }

  for (const filePath of transport.filePaths) {
    blocks.push({
      type: "resource_link",
      uri: pathToFileUri(filePath),
      name: getFileName(filePath),
    });
  }

  return blocks;
}

export function promptToQueuedEditorContent(
  prompt: QueuedCloudPrompt,
): EditorContent {
  const transport = getCloudPromptTransport(prompt);
  const attachments = transport.filePaths.map((filePath) => ({
    id: filePath,
    label: getFileName(filePath),
  }));
  const text =
    typeof prompt === "string"
      ? stripAbsoluteFileTags(prompt)
      : (transport.messageText ?? "");

  return {
    segments: [{ type: "text", text }],
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

export function combineQueuedCloudPrompts(
  queuedPrompts: Array<{ content: string; rawPrompt?: QueuedCloudPrompt }>,
): QueuedCloudPrompt | null {
  if (queuedPrompts.length === 0) {
    return null;
  }

  const blocks: ContentBlock[] = [];

  for (const [index, queuedPrompt] of queuedPrompts.entries()) {
    const promptBlocks = cloudPromptToBlocks(
      queuedPrompt.rawPrompt ?? queuedPrompt.content,
    );
    if (promptBlocks.length === 0) {
      continue;
    }

    if (index > 0 && blocks.length > 0) {
      blocks.push({ type: "text", text: "\n\n" });
    }

    blocks.push(...promptBlocks);
  }

  return blocks.length > 0 ? blocks : null;
}
