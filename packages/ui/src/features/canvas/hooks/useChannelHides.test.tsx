import type { Schemas } from "@posthog/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockClient = vi.hoisted(() => ({
  getDesktopFileSystemShortcuts: vi.fn(),
  createDesktopFileSystemShortcut: vi.fn(),
  deleteDesktopFileSystemShortcut: vi.fn(),
}));
vi.mock("@posthog/ui/features/auth/authClient", () => ({
  useOptionalAuthenticatedClient: () => mockClient,
}));
vi.mock("@posthog/ui/primitives/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useChannelHides, useChannelHideToggle } from "./useChannelHides";
import type { Channel } from "./useChannels";

function shortcut(
  id: string,
  type: string,
  ref: string | null,
): Schemas.FileSystemShortcut {
  return {
    id,
    path: ref?.replace(/^\/+/, "") ?? "x",
    type,
    ref,
    created_at: "2026-01-01T00:00:00Z",
  };
}

function channel(id: string, name: string, path: string): Channel {
  return { id, name, path };
}

let queryClient: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("useChannelHides", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("maps hidden-folder shortcuts by ref, ignoring stars and ref-less rows", async () => {
    mockClient.getDesktopFileSystemShortcuts.mockResolvedValue([
      shortcut("s1", "hidden-folder", "/alpha"),
      shortcut("s2", "folder", "/beta"), // a star, not a hide
      shortcut("s3", "hidden-folder", null), // no ref to link
    ]);

    const { result } = renderHook(() => useChannelHides(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect([...result.current.hiddenRefToShortcutId.entries()]).toEqual([
      ["/alpha", "s1"],
    ]);
  });

  it("hides an unhidden channel via its raw path, updating the cache immediately", async () => {
    mockClient.getDesktopFileSystemShortcuts.mockResolvedValue([]);

    const hides = renderHook(() => useChannelHides(), { wrapper });
    await waitFor(() => expect(hides.result.current.isLoading).toBe(false));

    const created = shortcut("s1", "hidden-folder", "/alpha");
    mockClient.createDesktopFileSystemShortcut.mockResolvedValue(created);
    // Hang the refetch so only the optimistic cache write is exercised.
    mockClient.getDesktopFileSystemShortcuts.mockReturnValue(
      new Promise(() => {}),
    );

    const toggle = renderHook(
      () => useChannelHideToggle(channel("1", "alpha", "/alpha")),
      { wrapper },
    );
    expect(toggle.result.current.isHidden).toBe(false);

    await act(async () => {
      toggle.result.current.toggleHidden();
    });

    expect(mockClient.createDesktopFileSystemShortcut).toHaveBeenCalledWith({
      path: "alpha",
      type: "hidden-folder",
      ref: "/alpha",
    });
    await waitFor(() =>
      expect(hides.result.current.hiddenRefToShortcutId.get("/alpha")).toBe(
        "s1",
      ),
    );
  });

  it("unhides a hidden channel by deleting its shortcut id", async () => {
    mockClient.getDesktopFileSystemShortcuts.mockResolvedValue([
      shortcut("s1", "hidden-folder", "/alpha"),
    ]);

    const hides = renderHook(() => useChannelHides(), { wrapper });
    await waitFor(() => expect(hides.result.current.isLoading).toBe(false));

    mockClient.deleteDesktopFileSystemShortcut.mockResolvedValue(undefined);
    mockClient.getDesktopFileSystemShortcuts.mockReturnValue(
      new Promise(() => {}),
    );

    const toggle = renderHook(
      () => useChannelHideToggle(channel("1", "alpha", "/alpha")),
      { wrapper },
    );
    expect(toggle.result.current.isHidden).toBe(true);

    await act(async () => {
      toggle.result.current.toggleHidden();
    });

    expect(mockClient.deleteDesktopFileSystemShortcut).toHaveBeenCalledWith(
      "s1",
    );
    await waitFor(() =>
      expect(hides.result.current.hiddenRefToShortcutId.has("/alpha")).toBe(
        false,
      ),
    );
  });
});
