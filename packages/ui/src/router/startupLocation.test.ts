import { describe, expect, it, vi } from "vitest";
import {
  canRestoreLocation,
  isRestorableLocation,
  personalNewTaskLocation,
} from "./startupLocation";

describe("startupLocation", () => {
  it("restores stable screens but not landing or pending screens", () => {
    expect(isRestorableLocation("/code/tasks/task-1")).toBe(true);
    expect(isRestorableLocation("/settings/general")).toBe(true);
    expect(isRestorableLocation("/code")).toBe(false);
    expect(isRestorableLocation("/code/tasks/pending/create-1")).toBe(false);
  });

  it("opens a new task in an existing me space", async () => {
    const client = {
      getDesktopFileSystemChannels: vi
        .fn()
        .mockResolvedValue([{ id: "me-id", path: "me", type: "folder" }]),
      createDesktopFileSystemChannel: vi.fn(),
    };

    await expect(personalNewTaskLocation(client as never)).resolves.toBe(
      "/website/me-id/new",
    );
    expect(client.createDesktopFileSystemChannel).not.toHaveBeenCalled();
  });

  it("creates the me space on first use", async () => {
    const client = {
      getDesktopFileSystemChannels: vi.fn().mockResolvedValue([]),
      createDesktopFileSystemChannel: vi
        .fn()
        .mockResolvedValue({ id: "new-me-id", path: "me", type: "folder" }),
    };

    await expect(personalNewTaskLocation(client as never)).resolves.toBe(
      "/website/new-me-id/new",
    );
  });

  it("rejects a deleted task or space", async () => {
    const client = {
      getTask: vi.fn().mockRejectedValue(new Error("Not found")),
      getDesktopFileSystemChannels: vi.fn().mockResolvedValue([]),
    };

    await expect(
      canRestoreLocation(client as never, "/code/tasks/deleted"),
    ).resolves.toBe(false);
    await expect(
      canRestoreLocation(client as never, "/website/deleted/context"),
    ).resolves.toBe(false);
  });
});
