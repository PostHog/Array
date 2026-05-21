import type { PromptRequest } from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import {
  promptToClaude,
  readToolGuidanceForPath,
  workspacePromptFromFileUri,
} from "./acp-to-sdk";

describe("readToolGuidanceForPath", () => {
  it.each([
    ["/docs/x.pdf", ["pages"]],
    ["/proj/app.ts", ["offset", "limit"]],
    ["/assets/logo.png", ["Binary", "file_path"]],
  ])("guides reads for %s", (filePath, keywords) => {
    const guidance = readToolGuidanceForPath(filePath);
    for (const keyword of keywords) {
      expect(guidance).toContain(keyword);
    }
  });
});

describe("workspacePromptFromFileUri", () => {
  it("includes file_path and Read-oriented chunking hints", () => {
    const s = workspacePromptFromFileUri("file:///tmp/x.pdf");
    expect(s).toContain("Read");
    expect(s).toContain("file_path: /tmp/x.pdf");
  });
});

describe("promptToClaude", () => {
  it("maps file resource_link to workspace path + Read guidance", () => {
    const result = promptToClaude({
      sessionId: "session-1",
      prompt: [
        {
          type: "resource_link",
          uri: "file:///tmp/workspace/.posthog/attachments/run-1/report.pdf",
          name: "report.pdf",
        },
      ],
    });

    expect(result.message.content.length).toBe(1);
    expect(result.message.content[0]).toMatchObject({
      type: "text",
      text: expect.any(String),
    });
    expect(
      (result.message.content[0] as { type: string; text: string }).text,
    ).toContain("file_path:");
    expect(
      (result.message.content[0] as { type: string; text: string }).text,
    ).toContain("/tmp/workspace/.posthog/attachments/run-1/report.pdf");
    const text = (result.message.content[0] as { text: string }).text;
    expect(text.toLowerCase()).toContain("read");
    expect(text).toContain("pages");
  });

  it("drops embedded body for file:// resource but keeps attachment:// payload", () => {
    const hugeInline = `${"y".repeat(30_000)}KEEP_ATTACH${"y".repeat(30_000)}`;
    const fileRes = promptToClaude({
      sessionId: "x",
      prompt: [
        {
          type: "resource",
          resource: {
            uri: "file:///tmp/note.txt",
            text: `${"x".repeat(50_000)}DROP_THIS${"x".repeat(50_000)}`,
            mimeType: "text/plain",
          },
        },
      ],
    });
    expect(fileRes.message.content.length).toBe(1);
    expect(JSON.stringify(fileRes)).not.toContain("DROP_THIS");
    expect(fileRes.message.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("file_path: /tmp/note.txt"),
    });

    const attachRes = promptToClaude({
      sessionId: "y",
      prompt: [
        {
          type: "resource",
          resource: {
            uri: "attachment://z?label=f.txt",
            text: hugeInline,
            mimeType: "text/plain",
          },
        },
      ],
    });
    expect(attachRes.message.content.length).toBe(2);
    expect(JSON.stringify(attachRes)).toContain("KEEP_ATTACH");
  });

  it("maps file URI-only image blocks to workspace Read prompt text", () => {
    const req: PromptRequest = {
      sessionId: "session-1",
      prompt: [
        {
          type: "image",
          uri: "file:///tmp/ui/screenshot.png",
          mimeType: "image/png",
        } as PromptRequest["prompt"][number],
      ],
    };
    const result = promptToClaude(req);

    expect(result.message.content).toHaveLength(1);
    expect(result.message.content[0]).toMatchObject({
      type: "text",
      text: expect.any(String),
    });
    expect(
      (result.message.content[0] as { type: string; text: string }).text,
    ).toContain("/tmp/ui/screenshot.png");
    expect(
      (
        result.message.content[0] as { type: string; text: string }
      ).text.toLowerCase(),
    ).toContain("read");
  });

  it("preserves non-file resource links as links", () => {
    const result = promptToClaude({
      sessionId: "session-1",
      prompt: [
        {
          type: "resource_link",
          uri: "https://example.com/report.pdf",
          name: "report.pdf",
        },
      ],
    });

    expect(result.message.content).toEqual([
      {
        type: "text",
        text: "https://example.com/report.pdf",
      },
    ]);
  });
});
