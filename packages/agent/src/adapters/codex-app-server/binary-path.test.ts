import { describe, expect, it, vi } from "vitest";

const existsSyncMock = vi.hoisted(() => vi.fn());
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: existsSyncMock,
}));

const { nativeCodexBinaryPath } = await import("./binary-path");

describe("nativeCodexBinaryPath", () => {
  it("returns undefined without a codex-acp path", () => {
    expect(nativeCodexBinaryPath(undefined)).toBeUndefined();
  });

  it("returns undefined when the sibling codex binary is absent", () => {
    existsSyncMock.mockReturnValue(false);
    expect(
      nativeCodexBinaryPath("/bundle/codex-acp/codex-acp"),
    ).toBeUndefined();
  });

  it("returns the sibling codex binary when present", () => {
    existsSyncMock.mockReturnValue(true);
    expect(nativeCodexBinaryPath("/bundle/codex-acp/codex-acp")).toBe(
      "/bundle/codex-acp/codex",
    );
  });
});
