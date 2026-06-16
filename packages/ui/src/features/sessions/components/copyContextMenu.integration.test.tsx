import { GithubRefChip } from "@posthog/ui/features/editor/components/GithubRefChip";
import {
  copyFromContextMenu,
  getGithubRefUrlFromEventTarget,
  resolveCopyText,
} from "@posthog/ui/features/sessions/components/copyContextTarget";
import { ContextMenu, Theme } from "@radix-ui/themes";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

const PR_URL = "https://github.com/PostHog/posthog/pull/63995";

// Radix's menu content mounts a scroll-area that observes resizes; jsdom lacks it.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

/**
 * Mirrors the exact context-menu wiring in SessionView: a ContextMenu.Trigger
 * whose child captures the right-clicked URL in a ref, and a "Copy" item that
 * copies the captured URL (falling back to the text selection).
 */
function Harness() {
  const copyTargetUrlRef = useRef<string | null>(null);
  const handleContextMenu = (e: React.MouseEvent) => {
    copyTargetUrlRef.current = getGithubRefUrlFromEventTarget(e.target);
  };
  return (
    <Theme>
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          {/** biome-ignore lint/a11y/noStaticElementInteractions: test harness */}
          <div onContextMenu={handleContextMenu}>
            <span>The draft PR is up: </span>
            <GithubRefChip href={PR_URL} kind="pr">
              PostHog/posthog#63995
            </GithubRefChip>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Content>
          <ContextMenu.Item
            onSelect={() => {
              const url = copyTargetUrlRef.current;
              const text = resolveCopyText(
                url,
                window.getSelection()?.toString(),
              );
              if (!text) {
                return;
              }
              copyFromContextMenu(text);
            }}
          >
            Copy
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    </Theme>
  );
}

describe("conversation context-menu copy (integration)", () => {
  it("copies the PR URL when right-clicking the chip and choosing Copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<Harness />);

    // Right-click the chip label, exactly as a user would.
    const label = screen.getByText("PostHog/posthog#63995");
    fireEvent.contextMenu(label);

    const copyItem = await screen.findByText("Copy");
    await userEvent.click(copyItem);

    // The write is deferred until after the menu closes (focus race), so wait.
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PR_URL));
  });
});
