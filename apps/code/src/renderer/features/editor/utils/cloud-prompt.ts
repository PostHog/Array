import { pathToFileURL } from "node:url";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { CLOUD_PROMPT_PREFIX, serializeCloudPrompt } from "@posthog/shared";
import { trpcClient } from "@renderer/trpc/client";
import { getImageMimeType, isImageFile } from "@shared/constants/image";
import { getFileExtension, getFileName, isAbsolutePath } from "@utils/path";
import { unescapeXmlAttr } from "@utils/xml";

const ABSOLUTE_FILE_TAG_REGEX = /<file\s+path="([^"]+)"\s*\/>/g;
const FOLDER_TAG_REGEX = /<folder\s+path="[^"]+"\s*\/>/g;
const FOLDER_TAG_PATH_REGEX = /<folder\s+path="([^"]+)"\s*\/>/g;
const TEXT_EXTENSIONS = new Set([
  "c",
  "cc",
  "cfg",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "env",
  "gitignore",
  "go",
  "h",
  "hpp",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsx",
  "log",
  "md",
  "mjs",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);
const TEXT_FILENAMES = new Set([
  ".env",
  ".gitignore",
  "Dockerfile",
  "LICENSE",
  "Makefile",
  "README",
  "README.md",
]);
const CLOUD_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

const MAX_EMBEDDED_IMAGE_BYTES = 5 * 1024 * 1024;

function isTextAttachment(filePath: string): boolean {
  const fileName = getFileName(filePath);
  const ext = getFileExtension(filePath);
  return TEXT_FILENAMES.has(fileName) || TEXT_EXTENSIONS.has(ext);
}

export function isSupportedCloudImageAttachment(filePath: string): boolean {
  return CLOUD_IMAGE_EXTENSIONS.has(getFileExtension(filePath));
}

export function isSupportedCloudTextAttachment(filePath: string): boolean {
  return isTextAttachment(filePath);
}

function estimateBase64Bytes(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function pathToFileUri(filePath: string): string {
  return pathToFileURL(filePath).href;
}

function collectAbsoluteFileTagPaths(prompt: string): string[] {
  const filePaths: string[] = [];

  for (const match of prompt.matchAll(ABSOLUTE_FILE_TAG_REGEX)) {
    const decodedPath = unescapeXmlAttr(match[1]);
    if (isAbsolutePath(decodedPath)) {
      filePaths.push(decodedPath);
    }
  }

  return filePaths;
}

function collectFolderTagPaths(prompt: string): Set<string> {
  const paths = new Set<string>();
  for (const match of prompt.matchAll(FOLDER_TAG_PATH_REGEX)) {
    paths.add(unescapeXmlAttr(match[1]));
  }
  return paths;
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function normalizePromptText(prompt: string): string {
  return prompt.replace(/\n{3,}/g, "\n\n").trim();
}

export function stripAbsoluteFileTags(prompt: string): string {
  return normalizePromptText(
    prompt
      .replaceAll(ABSOLUTE_FILE_TAG_REGEX, (match, rawPath: string) => {
        const decodedPath = unescapeXmlAttr(rawPath);
        return isAbsolutePath(decodedPath) ? "" : match;
      })
      .replaceAll(FOLDER_TAG_REGEX, ""),
  );
}

export function getAbsoluteAttachmentPaths(
  prompt: string,
  filePaths: string[] = [],
): string[] {
  const folderPaths = collectFolderTagPaths(prompt);
  const absolutePaths = [
    ...collectAbsoluteFileTagPaths(prompt),
    ...filePaths.filter(isAbsolutePath),
  ];
  return unique(absolutePaths).filter((p) => !folderPaths.has(p));
}

export function buildCloudTaskDescription(
  prompt: string,
  filePaths: string[] = [],
): string {
  const strippedPrompt = stripAbsoluteFileTags(prompt);
  const attachmentNames = getAbsoluteAttachmentPaths(prompt, filePaths).map(
    getFileName,
  );

  if (attachmentNames.length === 0) {
    return strippedPrompt;
  }

  const attachmentSummary = `Attached files: ${attachmentNames.join(", ")}`;
  return strippedPrompt
    ? `${strippedPrompt}\n\n${attachmentSummary}`
    : attachmentSummary;
}

async function buildAttachmentBlock(filePath: string): Promise<ContentBlock> {
  const fileName = getFileName(filePath);
  const uri = pathToFileUri(filePath);

  if (isSupportedCloudImageAttachment(fileName)) {
    const base64 = await trpcClient.fs.readFileAsBase64.query({ filePath });
    if (!base64) {
      throw new Error(`Unable to read attached image ${fileName}`);
    }

    if (estimateBase64Bytes(base64) > MAX_EMBEDDED_IMAGE_BYTES) {
      throw new Error(
        `${fileName} is too large for a cloud image attachment (max 5 MB)`,
      );
    }

    return {
      type: "image",
      data: base64,
      mimeType: getImageMimeType(fileName),
      uri,
    };
  }

  if (isImageFile(fileName)) {
    throw new Error(
      `Cloud image attachments currently support PNG, JPG, GIF, and WebP. Unsupported image: ${fileName}`,
    );
  }

  if (!isTextAttachment(fileName)) {
    throw new Error(
      `Cloud attachments currently support text and image files. Unsupported attachment: ${fileName}`,
    );
  }

  // Path-only: workspace text via `resource_link`; images above still embed base64.
  return {
    type: "resource_link",
    uri,
    name: fileName,
  };
}

/** Test/harness prompts: text → `resource_link` only (production cloud uses uploads + artifact_ids). */
export async function buildCloudPromptBlocks(
  prompt: string,
  filePaths: string[] = [],
): Promise<ContentBlock[]> {
  const promptText = stripAbsoluteFileTags(prompt);
  const attachmentPaths = getAbsoluteAttachmentPaths(prompt, filePaths);

  const attachmentBlocks = await Promise.all(
    attachmentPaths.map(buildAttachmentBlock),
  );

  const blocks: ContentBlock[] = [];
  if (promptText) {
    blocks.push({ type: "text", text: promptText });
  }
  blocks.push(...attachmentBlocks);

  if (blocks.length === 0) {
    throw new Error("Cloud prompt cannot be empty");
  }

  return blocks;
}

export { CLOUD_PROMPT_PREFIX, serializeCloudPrompt };
