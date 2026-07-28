import {
  estimateBase64Bytes,
  getFileExtension,
  MAX_CLAUDE_IMAGE_BYTES,
} from "@posthog/shared";
import * as FileSystem from "expo-file-system/legacy";
import type { CloudPromptBlock, PendingAttachment } from "./types";
import { isTextAttachment } from "./validation";

const MAX_EMBEDDED_TEXT_CHARS = 100_000;

function getTextMimeType(fileName: string, fallback: string): string {
  const ext = getFileExtension(fileName);
  switch (ext) {
    case "json":
      return "application/json";
    case "md":
      return "text/markdown";
    case "svg":
      return "image/svg+xml";
    case "xml":
      return "application/xml";
    default:
      return fallback.startsWith("text/") ? fallback : "text/plain";
  }
}

function truncateText(text: string): string {
  if (text.length <= MAX_EMBEDDED_TEXT_CHARS) return text;
  return `${text.slice(0, MAX_EMBEDDED_TEXT_CHARS)}\n\n[Attachment truncated to ${MAX_EMBEDDED_TEXT_CHARS.toLocaleString()} characters for this cloud prompt.]`;
}

async function buildBlock(att: PendingAttachment): Promise<CloudPromptBlock> {
  if (att.kind === "image") {
    const base64 = await FileSystem.readAsStringAsync(att.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (estimateBase64Bytes(base64) > MAX_CLAUDE_IMAGE_BYTES) {
      throw new Error(
        `${att.fileName} is too large for a cloud image attachment (max 5 MB).`,
      );
    }
    return {
      type: "image",
      data: base64,
      mimeType: att.mimeType || "image/jpeg",
      uri: `attachment://${att.fileName}`,
    };
  }

  // Document attachment — must be text-readable.
  if (!isTextAttachment(att.mimeType, att.fileName)) {
    throw new Error(
      `Cloud attachments support text and image files. Unsupported: ${att.fileName}`,
    );
  }
  const text = await FileSystem.readAsStringAsync(att.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return {
    type: "resource",
    resource: {
      uri: `attachment://${att.fileName}`,
      text: truncateText(text),
      mimeType: getTextMimeType(att.fileName, att.mimeType),
    },
  };
}

/**
 * Reads each attachment from disk and assembles the cloud-prompt block array
 * the agent server expects. Throws if any individual attachment fails so the
 * caller can surface a single, attributable error to the user.
 */
export async function buildCloudPromptBlocks(
  text: string,
  attachments: PendingAttachment[],
): Promise<CloudPromptBlock[]> {
  const blocks: CloudPromptBlock[] = [];
  const trimmed = text.trim();
  if (trimmed) blocks.push({ type: "text", text: trimmed });
  for (const attachment of attachments) {
    blocks.push(await buildBlock(attachment));
  }
  if (blocks.length === 0) {
    throw new Error("Cloud prompt cannot be empty");
  }
  return blocks;
}
