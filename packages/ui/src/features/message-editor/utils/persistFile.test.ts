import { beforeEach, describe, expect, it, vi } from "vitest";

const mockDownscaleImageFile = vi.hoisted(() => vi.fn());
const mockGetFilePath = vi.hoisted(() => vi.fn());

vi.mock("@posthog/di/container", () => ({
  resolveService: () => ({
    downscaleImageFile: mockDownscaleImageFile,
  }),
}));

vi.mock("@posthog/ui/utils/getFilePath", () => ({
  getFilePath: mockGetFilePath,
}));

const mockToastWarning = vi.hoisted(() => vi.fn());
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { warning: mockToastWarning },
}));

import {
  resolveAndAttachDroppedFiles,
  resolveDroppedFile,
} from "./persistFile";

describe("resolveDroppedFile (UI glue)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when getFilePath returns empty string", async () => {
    mockGetFilePath.mockReturnValue("");

    const file = { name: "test.txt" } as File;
    expect(await resolveDroppedFile(file)).toBeNull();
  });

  it("returns file attachment directly for non-image files", async () => {
    mockGetFilePath.mockReturnValue("/Users/me/doc.pdf");

    const file = { name: "doc.pdf" } as File;
    const result = await resolveDroppedFile(file);

    expect(result).toEqual({ id: "/Users/me/doc.pdf", label: "doc.pdf" });
    expect(mockDownscaleImageFile).not.toHaveBeenCalled();
  });

  it("shows warning toast when image downscaling fails", async () => {
    mockGetFilePath.mockReturnValue("/Users/me/corrupt.png");
    mockDownscaleImageFile.mockRejectedValue(new Error("decode failed"));

    const file = { name: "corrupt.png" } as File;
    expect(await resolveDroppedFile(file)).toEqual({
      id: "/Users/me/corrupt.png",
      label: "corrupt.png",
    });
    expect(mockToastWarning).toHaveBeenCalledWith(
      "Image could not be downscaled",
      { description: "Attaching original file instead" },
    );
  });
});

describe("resolveAndAttachDroppedFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls addAttachment for each resolved file", async () => {
    mockGetFilePath
      .mockReturnValueOnce("/Users/me/a.txt")
      .mockReturnValueOnce("")
      .mockReturnValueOnce("/Users/me/b.txt");

    const files = [
      { name: "a.txt" },
      { name: "skip.txt" },
      { name: "b.txt" },
    ] as unknown as FileList;
    Object.defineProperty(files, "length", { value: 3 });

    const addAttachment = vi.fn();
    await resolveAndAttachDroppedFiles(files, addAttachment);

    expect(addAttachment).toHaveBeenCalledTimes(2);
    expect(addAttachment).toHaveBeenCalledWith({
      id: "/Users/me/a.txt",
      label: "a.txt",
    });
    expect(addAttachment).toHaveBeenCalledWith({
      id: "/Users/me/b.txt",
      label: "b.txt",
    });
  });
});
