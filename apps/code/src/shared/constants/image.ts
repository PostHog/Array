export const IMAGE_MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml",
  tiff: "image/tiff",
  tif: "image/tiff",
};

const IMAGE_EXTENSIONS = new Set(Object.keys(IMAGE_MIME_TYPES));

export function isImageFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return !!ext && IMAGE_EXTENSIONS.has(ext);
}

export function isGifFile(filename: string): boolean {
  return filename.split(".").pop()?.toLowerCase() === "gif";
}

export function getImageMimeType(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_MIME_TYPES[ext] ?? "application/octet-stream";
}
