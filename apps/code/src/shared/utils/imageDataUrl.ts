const ALLOWED_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/tiff",
  "image/avif",
]);

const DATA_URL_PATTERN =
  /^data:([a-zA-Z]+\/[a-zA-Z0-9.+-]+)(?:;[a-zA-Z0-9-]+=[^;,]+)*;base64,([A-Za-z0-9+/=\s]+)$/;

const MAX_BASE64_LENGTH = 20 * 1024 * 1024;

export interface ParsedImageDataUrl {
  mimeType: string;
  base64: string;
}

export function parseImageDataUrl(value: string): ParsedImageDataUrl | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_BASE64_LENGTH) return null;
  if (!trimmed.startsWith("data:")) return null;

  const match = DATA_URL_PATTERN.exec(trimmed);
  if (!match) return null;

  const mimeType = match[1].toLowerCase();
  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) return null;

  const base64 = match[2].replace(/\s+/g, "");
  if (base64.length === 0) return null;

  return { mimeType, base64 };
}

export function isAllowedImageMimeType(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

export function buildImageDataUrl(mimeType: string, base64: string): string {
  return `data:${mimeType};base64,${base64}`;
}
