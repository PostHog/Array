import { rendererStateStorage } from "@posthog/ui/shell/rendererStorage";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  personalNewTaskLocation,
  resolveStartupLocation,
} from "./startupLocation";

describe("startup location", () => {
  afterEach(() => vi.restoreAllMocks());

  it("restores the exact last location", async () => {
    vi.spyOn(rendererStateStorage, "getItem").mockResolvedValue("/code");
    const client = {
      getDesktopFileSystemChannels: vi.fn(),
      createDesktopFileSystemChannel: vi.fn(),
    };

    await expect(resolveStartupLocation("project", client)).resolves.toBe(
      "/code",
    );
    expect(client.getDesktopFileSystemChannels).not.toHaveBeenCalled();
  });

  it("opens a new task in an existing me space", async () => {
    const client = {
      getDesktopFileSystemChannels: vi
        .fn()
        .mockResolvedValue([{ id: "me-id", path: "me", type: "folder" }]),
      createDesktopFileSystemChannel: vi.fn(),
    };

    await expect(personalNewTaskLocation(client)).resolves.toBe(
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

    await expect(personalNewTaskLocation(client)).resolves.toBe(
      "/website/new-me-id/new",
    );
  });
});
