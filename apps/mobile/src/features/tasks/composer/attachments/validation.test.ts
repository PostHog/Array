import { MAX_CLAUDE_IMAGE_BYTES } from "@posthog/shared";
import { describe, expect, it } from "vitest";
import type { PendingAttachment } from "./types";
import { validateAttachment } from "./validation";

function attachment(overrides: Partial<PendingAttachment>): PendingAttachment {
  return {
    kind: "document",
    id: "a1",
    uri: "file://x",
    fileName: "notes.txt",
    mimeType: "text/plain",
    ...overrides,
  } as PendingAttachment;
}

describe("validateAttachment", () => {
  it.each([
    {
      name: "oversized image is rejected",
      att: attachment({
        kind: "image",
        fileName: "huge.png",
        mimeType: "image/png",
        sizeBytes: MAX_CLAUDE_IMAGE_BYTES + 1,
      }),
      valid: false,
    },
    {
      name: "supported image within the size limit is accepted",
      att: attachment({
        kind: "image",
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
      }),
      valid: true,
    },
    {
      name: "image with unknown size is accepted (checked again at send)",
      att: attachment({
        kind: "image",
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: undefined,
      }),
      valid: true,
    },
    {
      name: "unsupported binary document is rejected",
      att: attachment({
        fileName: "archive.zip",
        mimeType: "application/zip",
      }),
      valid: false,
    },
    {
      name: "text document is accepted by mime type",
      att: attachment({ fileName: "data", mimeType: "text/csv" }),
      valid: true,
    },
    {
      name: "code document is accepted by extension",
      att: attachment({
        fileName: "main.ts",
        mimeType: "application/octet-stream",
      }),
      valid: true,
    },
  ])("$name", ({ att, valid }) => {
    const reason = validateAttachment(att);
    if (valid) {
      expect(reason).toBeNull();
    } else {
      expect(reason).toContain(att.fileName);
    }
  });
});
