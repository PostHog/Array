import { fileURLToPath } from "node:url";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFs = vi.hoisted(() => ({
  readAbsoluteFile: { query: vi.fn() },
  readFileAsBase64: { query: vi.fn() },
}));

vi.mock("@shared/constants/image", async () => {
  const actual = await vi.importActual<
    typeof import("@shared/constants/image")
  >("@shared/constants/image");
  return {
    ...actual,
    getImageMimeType: (name: string) => {
      const ext = name.split(".").pop()?.toLowerCase();
      const map: Record<string, string> = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        webp: "image/webp",
      };
      return map[ext ?? ""] ?? "image/png";
    },
  };
});

vi.mock("@renderer/trpc/client", () => ({
  trpcClient: {
    fs: mockFs,
  },
}));

import {
  buildCloudPromptBlocks,
  buildCloudTaskDescription,
  serializeCloudPrompt,
  stripAbsoluteFileTags,
} from "./cloud-prompt";

function resourceLinksFrom(blocks: ContentBlock[]): string[] {
  return blocks.flatMap((b) =>
    b.type === "resource_link" && typeof b.uri === "string" ? [b.uri] : [],
  );
}

describe("cloud-prompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips absolute file tags but keeps repo file tags", () => {
    const prompt =
      'review <file path="src/index.ts" /> and <file path="/tmp/test.txt" />';

    expect(stripAbsoluteFileTags(prompt)).toBe(
      'review <file path="src/index.ts" /> and',
    );
  });

  it("strips folder tags from the prompt", () => {
    const prompt =
      'look at <folder path="src/foo" /> and <file path="src/index.ts" />';

    expect(stripAbsoluteFileTags(prompt)).toBe(
      'look at  and <file path="src/index.ts" />',
    );
  });

  it("excludes folder paths from absolute attachment list", async () => {
    const prompt =
      'scan <folder path="/abs/dir" /> and <file path="/tmp/test.txt" />';
    const blocks = await buildCloudPromptBlocks(prompt, [
      "/abs/dir",
      "/tmp/test.txt",
    ]);

    const uris = resourceLinksFrom(blocks);
    expect(uris).toHaveLength(1);
    expect(uris[0]).toContain("test.txt");
    expect(mockFs.readAbsoluteFile.query).not.toHaveBeenCalled();
  });

  it("builds a safe cloud task description for local attachments", () => {
    const description = buildCloudTaskDescription(
      'review <file path="src/index.ts" /> and <file path="/tmp/test.txt" />',
    );

    expect(description).toBe(
      'review <file path="src/index.ts" /> and\n\nAttached files: test.txt',
    );
  });

  it("uses resource_link path references for text attachments", async () => {
    const blocks = await buildCloudPromptBlocks(
      'read this <file path="/tmp/test.txt" />',
    );

    expect(blocks).toEqual([
      { type: "text", text: "read this" },
      {
        type: "resource_link",
        uri: expect.stringMatching(/^file:\/\/.+/),
        name: "test.txt",
      },
    ]);

    const attachmentBlock = blocks[1];
    expect(attachmentBlock.type).toBe("resource_link");
    if (attachmentBlock.type !== "resource_link") {
      throw new Error("Expected a resource_link attachment block");
    }

    expect(fileURLToPath(attachmentBlock.uri)).toBe("/tmp/test.txt");
    expect(mockFs.readAbsoluteFile.query).not.toHaveBeenCalled();
  });

  it("encodes Windows drive paths as file URIs", async () => {
    const blocks = await buildCloudPromptBlocks(
      'read <file path="C:\\\\tmp\\\\100%\\\\a#b?.txt" />',
    );

    const uris = resourceLinksFrom(blocks);
    expect(uris).toHaveLength(1);
    // C:\tmp\100%\a#b?.txt → file:///C:/tmp/100%25/a%23b%3F.txt
    expect(uris[0]).toBe("file:///C:/tmp/100%25/a%23b%3F.txt");
  });

  it("encodes Windows UNC paths as file URIs", async () => {
    const blocks = await buildCloudPromptBlocks(
      'read <file path="\\\\\\\\server\\\\share\\\\My Folder\\\\file.txt" />',
    );

    const uris = resourceLinksFrom(blocks);
    expect(uris).toHaveLength(1);
    expect(uris[0]).toBe("file://server/share/My%20Folder/file.txt");
  });

  it("embeds image attachments as ACP image blocks", async () => {
    const fakeBase64 = btoa("tiny-image-data");
    mockFs.readFileAsBase64.query.mockResolvedValue(fakeBase64);

    const blocks = await buildCloudPromptBlocks(
      'check <file path="/tmp/screenshot.png" />',
    );

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "text", text: "check" });
    expect(blocks[1]).toMatchObject({
      type: "image",
      data: fakeBase64,
      mimeType: "image/png",
    });
  });

  it("rejects images over 5 MB", async () => {
    // 5 MB in base64 is ~6.67M chars; generate slightly over
    const oversize = "A".repeat(7_000_000);
    mockFs.readFileAsBase64.query.mockResolvedValue(oversize);

    await expect(
      buildCloudPromptBlocks('see <file path="/tmp/huge.png" />'),
    ).rejects.toThrow(/too large/);
  });

  it("rejects unsupported image formats", async () => {
    await expect(
      buildCloudPromptBlocks('see <file path="/tmp/photo.bmp" />'),
    ).rejects.toThrow(/Unsupported image/);
  });

  it("does not rely on readAbsoluteFile for txt attachments", async () => {
    mockFs.readAbsoluteFile.query.mockResolvedValue(null);

    const blocks = await buildCloudPromptBlocks(
      'read <file path="/tmp/maybe-missing-on-disk.txt" />',
    );
    expect(blocks[1]).toMatchObject({
      type: "resource_link",
      name: "maybe-missing-on-disk.txt",
    });
    expect(mockFs.readAbsoluteFile.query).not.toHaveBeenCalled();
  });

  it("throws when readFileAsBase64 returns falsy for images", async () => {
    mockFs.readFileAsBase64.query.mockResolvedValue(null);

    await expect(
      buildCloudPromptBlocks('see <file path="/tmp/broken.png" />'),
    ).rejects.toThrow(/Unable to read/);
  });

  it("throws on empty prompt with no attachments", async () => {
    await expect(buildCloudPromptBlocks("")).rejects.toThrow(/cannot be empty/);
  });

  it("serializes structured prompts for pending cloud messages", () => {
    const serialized = serializeCloudPrompt([
      { type: "text", text: "read this" },
      {
        type: "resource_link",
        uri: "file:///tmp/test.txt",
        name: "test.txt",
      },
    ]);

    expect(serialized).toContain("__twig_cloud_prompt_v1__:");
    expect(serialized).toContain('"type":"resource_link"');
  });
});
