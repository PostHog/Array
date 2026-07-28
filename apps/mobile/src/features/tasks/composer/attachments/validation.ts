import { getFileExtension, MAX_CLAUDE_IMAGE_BYTES } from "@posthog/shared";
import type { PendingAttachment } from "./types";

const TEXT_MIME_PREFIXES = ["text/"];
const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-sh",
  "application/x-yaml",
  "application/x-toml",
]);
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

export function isTextAttachment(mimeType: string, fileName: string): boolean {
  const mt = mimeType.toLowerCase();
  if (TEXT_MIME_PREFIXES.some((p) => mt.startsWith(p))) return true;
  if (TEXT_MIME_TYPES.has(mt)) return true;
  return TEXT_EXTENSIONS.has(getFileExtension(fileName));
}

/**
 * Cheap pick-time check for problems that would otherwise only surface when
 * `buildCloudPromptBlocks` reads the bytes at send-time. Uses the size and
 * mime/extension the picker already returns, so it never reads the file.
 * Returns a human-readable reason, or `null` when the attachment is usable.
 */
export function validateAttachment(att: PendingAttachment): string | null {
  if (att.kind === "image") {
    if (att.sizeBytes != null && att.sizeBytes > MAX_CLAUDE_IMAGE_BYTES) {
      return `${att.fileName} is too large to attach (max 5 MB).`;
    }
    return null;
  }
  if (!isTextAttachment(att.mimeType, att.fileName)) {
    return `${att.fileName} isn't supported. Cloud attachments only support text and image files.`;
  }
  return null;
}
