import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  buildCloudTaskDescription,
  getAbsoluteAttachmentPaths,
  stripAbsoluteFileTags,
} from "@features/editor/utils/cloud-prompt";
import type {
  PostHogAPIClient,
  PreparedTaskArtifactUpload,
  TaskArtifactUploadRequest,
} from "@renderer/api/posthogClient";
import { trpcClient } from "@renderer/trpc/client";
import { getFileName, pathToFileUri } from "@utils/path";
import type { EditorContent } from "../../message-editor/utils/content";

const FILE_URI_PREFIX = "file://";
const ATTACHMENT_SOURCE = "posthog_code";
const DEFAULT_CONTENT_TYPE = "application/octet-stream";
export const CLOUD_ATTACHMENT_MAX_SIZE_BYTES = 30 * 1024 * 1024;
export const CLOUD_PDF_ATTACHMENT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  bmp: "image/bmp",
  c: "text/plain",
  cc: "text/plain",
  conf: "text/plain",
  cpp: "text/plain",
  css: "text/css",
  csv: "text/csv",
  gif: "image/gif",
  go: "text/plain",
  h: "text/plain",
  html: "text/html",
  ini: "text/plain",
  java: "text/plain",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "text/javascript",
  json: "application/json",
  jsx: "text/javascript",
  log: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  py: "text/x-python",
  rb: "text/plain",
  rs: "text/plain",
  sh: "text/x-shellscript",
  sql: "application/sql",
  svg: "image/svg+xml",
  toml: "application/toml",
  ts: "text/typescript",
  tsx: "text/typescript",
  txt: "text/plain",
  webp: "image/webp",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  zip: "application/zip",
};

interface LoadedCloudAttachment {
  filePath: string;
  bytes: Uint8Array<ArrayBuffer>;
  upload: TaskArtifactUploadRequest;
}

export interface CloudPromptTransport {
  filePaths: string[];
  messageText?: string;
  promptText: string;
}

export type QueuedCloudPrompt = string | ContentBlock[];

function base64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function getFileExtension(filePath: string): string {
  const parts = getFileName(filePath).split(".");
  return parts.length > 1 ? (parts.at(-1)?.toLowerCase() ?? "") : "";
}

function inferContentType(filePath: string): string {
  return (
    CONTENT_TYPE_BY_EXTENSION[getFileExtension(filePath)] ??
    DEFAULT_CONTENT_TYPE
  );
}

function getCloudAttachmentMaxSizeBytes(
  filePath: string,
  contentType: string,
): number {
  const extension = getFileExtension(filePath);
  const normalizedContentType =
    contentType.split(";")[0]?.trim().toLowerCase() ?? "";

  if (extension === "pdf" || normalizedContentType === "application/pdf") {
    return CLOUD_PDF_ATTACHMENT_MAX_SIZE_BYTES;
  }

  return CLOUD_ATTACHMENT_MAX_SIZE_BYTES;
}

function getCloudAttachmentSizeError(
  filePath: string,
  maxSizeBytes: number,
): string {
  const maxMb = Math.floor(maxSizeBytes / (1024 * 1024));

  if (getFileExtension(filePath) === "pdf") {
    return `${getFileName(filePath)} exceeds the ${maxMb}MB attachment limit for PDFs in cloud runs`;
  }

  return `${getFileName(filePath)} exceeds the ${maxMb}MB attachment limit`;
}

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

async function loadCloudAttachments(
  filePaths: string[],
): Promise<LoadedCloudAttachment[]> {
  return Promise.all(
    filePaths.map(async (filePath) => {
      const base64 = await trpcClient.fs.readFileAsBase64.query({ filePath });
      if (!base64) {
        throw new Error(
          `Unable to read attached file ${getFileName(filePath)}`,
        );
      }

      const bytes = base64ToUint8Array(base64);
      const contentType = inferContentType(filePath);
      const maxSizeBytes = getCloudAttachmentMaxSizeBytes(
        filePath,
        contentType,
      );
      if (bytes.byteLength > maxSizeBytes) {
        throw new Error(getCloudAttachmentSizeError(filePath, maxSizeBytes));
      }
      return {
        filePath,
        bytes,
        upload: {
          name: getFileName(filePath),
          type: "user_attachment",
          source: ATTACHMENT_SOURCE,
          size: bytes.byteLength,
          content_type: contentType,
        },
      };
    }),
  );
}

async function uploadPreparedArtifacts(
  attachments: LoadedCloudAttachment[],
  preparedArtifacts: PreparedTaskArtifactUpload[],
): Promise<void> {
  if (attachments.length !== preparedArtifacts.length) {
    throw new Error("Prepared uploads do not match the selected attachments");
  }

  await Promise.all(
    preparedArtifacts.map(async (preparedArtifact, index) => {
      const attachment = attachments[index];
      const formData = new FormData();

      for (const [key, value] of Object.entries(
        preparedArtifact.presigned_post.fields,
      )) {
        formData.append(key, value);
      }

      formData.append(
        "file",
        new Blob([attachment.bytes], {
          type: attachment.upload.content_type || DEFAULT_CONTENT_TYPE,
        }),
        attachment.upload.name,
      );

      const response = await fetch(preparedArtifact.presigned_post.url, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Failed to upload ${attachment.upload.name}`);
      }
    }),
  );
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

export async function uploadTaskStagedAttachments(
  client: PostHogAPIClient,
  taskId: string,
  filePaths: string[],
): Promise<string[]> {
  if (!filePaths.length) {
    return [];
  }

  const attachments = await loadCloudAttachments(filePaths);
  const preparedArtifacts = await client.prepareTaskStagedArtifactUploads(
    taskId,
    attachments.map((attachment) => attachment.upload),
  );

  await uploadPreparedArtifacts(attachments, preparedArtifacts);

  const finalizedArtifacts = await client.finalizeTaskStagedArtifactUploads(
    taskId,
    preparedArtifacts,
  );

  return finalizedArtifacts.map((artifact) => artifact.id);
}

export async function uploadRunAttachments(
  client: PostHogAPIClient,
  taskId: string,
  runId: string,
  filePaths: string[],
): Promise<string[]> {
  if (!filePaths.length) {
    return [];
  }

  const attachments = await loadCloudAttachments(filePaths);
  const preparedArtifacts = await client.prepareTaskRunArtifactUploads(
    taskId,
    runId,
    attachments.map((attachment) => attachment.upload),
  );

  await uploadPreparedArtifacts(attachments, preparedArtifacts);

  const finalizedArtifacts = await client.finalizeTaskRunArtifactUploads(
    taskId,
    runId,
    preparedArtifacts,
  );

  return finalizedArtifacts.map((artifact) => artifact.id);
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
