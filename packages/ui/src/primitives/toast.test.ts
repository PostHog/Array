import { beforeEach, describe, expect, it, vi } from "vitest";

const quill = vi.hoisted(() => {
  let n = 0;
  const make = () =>
    vi.fn(
      (_opts?: { onClose?: () => void } & Record<string, unknown>) => `q${++n}`,
    );
  return {
    success: make(),
    error: make(),
    info: make(),
    warning: make(),
    loading: make(),
    update: vi.fn(),
    dismiss: vi.fn(),
    _reset: () => {
      n = 0;
    },
  };
});

vi.mock("@posthog/quill", () => ({ toast: quill }));

import { toast } from "./toast";

beforeEach(() => {
  vi.clearAllMocks();
  quill._reset();
  // clearAllMocks resets the level fns to undefined returns; restore ids.
  let n = 0;
  for (const key of [
    "success",
    "error",
    "info",
    "warning",
    "loading",
  ] as const) {
    quill[key].mockImplementation(() => `q${++n}`);
  }
});

describe("toast wrapper", () => {
  it("creates without an id and forwards title/description/timeout", () => {
    toast.success("Saved", { description: "All good", duration: 1000 });
    expect(quill.success).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Saved",
        description: "All good",
        timeout: 1000,
      }),
    );
    expect(quill.update).not.toHaveBeenCalled();
  });

  it("upserts a stable id: first call creates, repeat call updates the same toast", () => {
    // Regression: a fresh caller-chosen id must CREATE (not no-op via update).
    toast.success("Task archived", { id: "archive-1" });
    expect(quill.success).toHaveBeenCalledTimes(1);
    expect(quill.update).not.toHaveBeenCalled();

    toast.error("Now failed", { id: "archive-1" });
    // Same id → updates the previously-created quill toast, no new create.
    expect(quill.error).not.toHaveBeenCalled();
    expect(quill.update).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ type: "error", title: "Now failed" }),
    );
  });

  it("dismiss(stableId) resolves through the registry to the quill id", () => {
    toast.success("Archived", { id: "archive-2" });
    toast.dismiss("archive-2");
    expect(quill.dismiss).toHaveBeenCalledWith("q1");
  });

  it("dismiss falls back to the raw id for unregistered (loading-returned) ids", () => {
    const id = toast.loading("Working…"); // returns the raw quill id
    toast.dismiss(id);
    expect(quill.dismiss).toHaveBeenCalledWith(id);
  });

  it("maps duration Infinity to timeout 0 (base-ui 'never auto-dismiss')", () => {
    toast.error("Offline", { duration: Number.POSITIVE_INFINITY });
    expect(quill.error).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 0 }),
    );
  });

  it("after a toast closes, its id frees up to create again", () => {
    toast.success("First", { id: "dup" });
    quill.success.mock.calls[0]?.[0]?.onClose?.(); // simulate the toast closing
    toast.success("Second", { id: "dup" });
    // Recreated (two creates), not updated.
    expect(quill.success).toHaveBeenCalledTimes(2);
    expect(quill.update).not.toHaveBeenCalled();
  });
});
