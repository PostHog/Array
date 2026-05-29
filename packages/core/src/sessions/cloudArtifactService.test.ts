import { describe, expect, it, vi } from "vitest";
import type { CloudArtifactClient } from "./cloudArtifactIdentifiers";
import {
  CLOUD_ATTACHMENT_MAX_SIZE_BYTES,
  CLOUD_PDF_ATTACHMENT_MAX_SIZE_BYTES,
  CloudArtifactService,
} from "./cloudArtifactService";

function makeClient(): CloudArtifactClient {
  return {
    prepareTaskStagedArtifactUploads: vi.fn(),
    finalizeTaskStagedArtifactUploads: vi.fn(),
    prepareTaskRunArtifactUploads: vi.fn(),
    finalizeTaskRunArtifactUploads: vi.fn(),
  };
}

describe("CloudArtifactService", () => {
  it("returns empty ids when no file paths are provided", async () => {
    const service = new CloudArtifactService(vi.fn());
    expect(
      await service.uploadRunAttachments(makeClient(), "t", "r", []),
    ).toEqual([]);
  });

  it("rejects attachments that exceed the max size", async () => {
    const oversized = CLOUD_ATTACHMENT_MAX_SIZE_BYTES + 1;
    const base64 = btoa("a".repeat(oversized));
    const service = new CloudArtifactService(vi.fn().mockResolvedValue(base64));

    await expect(
      service.uploadRunAttachments(makeClient(), "task-1", "run-1", [
        "/tmp/huge.bin",
      ]),
    ).rejects.toThrow(/exceeds the 30MB attachment limit/);
  });

  it("rejects PDFs that exceed the stricter cloud limit", async () => {
    const oversized = CLOUD_PDF_ATTACHMENT_MAX_SIZE_BYTES + 1;
    const base64 = btoa("a".repeat(oversized));
    const service = new CloudArtifactService(vi.fn().mockResolvedValue(base64));

    await expect(
      service.uploadRunAttachments(makeClient(), "task-1", "run-1", [
        "/tmp/large.pdf",
      ]),
    ).rejects.toThrow(
      /exceeds the 10MB attachment limit for PDFs in cloud runs/,
    );
  });

  it("throws when a file cannot be read", async () => {
    const service = new CloudArtifactService(vi.fn().mockResolvedValue(null));

    await expect(
      service.uploadRunAttachments(makeClient(), "task-1", "run-1", [
        "/tmp/missing.txt",
      ]),
    ).rejects.toThrow(/Unable to read attached file missing\.txt/);
  });

  it("runs prepare, POST, finalize and tallies the artifact ids", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true } as Response);
    const base64 = btoa("hello");
    const service = new CloudArtifactService(vi.fn().mockResolvedValue(base64));

    const client = makeClient();
    (
      client.prepareTaskRunArtifactUploads as ReturnType<typeof vi.fn>
    ).mockResolvedValue([
      {
        id: "prep-1",
        name: "a.txt",
        type: "user_attachment",
        size: 5,
        presigned_post: { url: "https://s3/upload", fields: { key: "k" } },
      },
    ]);
    (
      client.finalizeTaskRunArtifactUploads as ReturnType<typeof vi.fn>
    ).mockResolvedValue([{ id: "artifact-1" }]);

    const ids = await service.uploadRunAttachments(client, "task-1", "run-1", [
      "/tmp/a.txt",
    ]);

    expect(ids).toEqual(["artifact-1"]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://s3/upload",
      expect.objectContaining({ method: "POST" }),
    );
    fetchMock.mockRestore();
  });
});
