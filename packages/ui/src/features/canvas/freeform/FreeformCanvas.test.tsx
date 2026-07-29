import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_BOOT_TIMEOUT_ERROR, FreeformCanvas } from "./FreeformCanvas";

vi.mock("@posthog/ui/shell/openExternal", () => ({
  openExternalUrl: vi.fn(),
}));

const renderCanvas = (
  props?: Partial<ComponentProps<typeof FreeformCanvas>>,
) => {
  render(
    <FreeformCanvas
      code="export default function Canvas() { return null }"
      mode="edit"
      onDataRequest={vi.fn()}
      {...props}
    />,
  );
  return screen.getByTitle("Canvas") as HTMLIFrameElement;
};

const postFrameFromCanvas = (
  iframe: HTMLIFrameElement,
  frame: Record<string, unknown>,
) => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { channel: "posthog-canvas", ...frame },
      source: iframe.contentWindow,
    }),
  );
};

const postFromCanvas = (iframe: HTMLIFrameElement, url: string) => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { channel: "posthog-canvas", type: "open-external", url },
      source: iframe.contentWindow,
    }),
  );
};

describe("FreeformCanvas", () => {
  it("does not grant the sandbox popup permission", () => {
    renderCanvas();

    expect(screen.getByTitle("Canvas")).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
  });

  // A sandbox that never boots (blocked/hung CDN fetch, blocked srcDoc) posts
  // nothing at all, so without a watchdog the host shows an indefinitely blank
  // frame with nothing to act on.
  describe("boot watchdog", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("reports an error when the sandbox never renders", () => {
      const onError = vi.fn();
      renderCanvas({ onError });

      vi.advanceTimersByTime(30_001);

      expect(onError).toHaveBeenCalledWith(CANVAS_BOOT_TIMEOUT_ERROR);
    });

    it.each([
      { name: "rendered", frame: { type: "rendered" } },
      { name: "error", frame: { type: "error", message: "boom" } },
    ])("stops waiting once the sandbox posts $name", ({ frame }) => {
      const onError = vi.fn();
      const iframe = renderCanvas({ onError });

      postFrameFromCanvas(iframe, frame);
      onError.mockClear();
      vi.advanceTimersByTime(30_001);

      expect(onError).not.toHaveBeenCalled();
    });

    it("does not wait on a canvas with no code to render", () => {
      const onError = vi.fn();
      renderCanvas({ code: "", onError });

      vi.advanceTimersByTime(30_001);

      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe("open-external", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.mocked(openExternalUrl).mockClear();
    });

    it("opens PostHog https URLs once the user has focused the canvas", () => {
      const iframe = renderCanvas();
      iframe.focus();

      postFromCanvas(iframe, "https://posthog.com/docs");

      expect(openExternalUrl).toHaveBeenCalledWith("https://posthog.com/docs");
    });

    it("drops opens when the user has not interacted with the canvas", () => {
      const iframe = renderCanvas();

      postFromCanvas(iframe, "https://posthog.com/docs");

      expect(openExternalUrl).not.toHaveBeenCalled();
    });

    it("drops non-PostHog URLs", () => {
      const iframe = renderCanvas();
      iframe.focus();

      postFromCanvas(iframe, "https://example.com");
      postFromCanvas(iframe, "javascript:alert(1)");
      postFromCanvas(iframe, "mailto:hi@posthog.com");

      expect(openExternalUrl).not.toHaveBeenCalled();
    });

    it("throttles rapid opens so canvas code cannot spam the launcher", () => {
      const iframe = renderCanvas();
      iframe.focus();

      postFromCanvas(iframe, "https://posthog.com/a");
      postFromCanvas(iframe, "https://posthog.com/b");
      expect(openExternalUrl).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1_001);
      postFromCanvas(iframe, "https://posthog.com/c");
      expect(openExternalUrl).toHaveBeenCalledTimes(2);
      expect(openExternalUrl).toHaveBeenLastCalledWith("https://posthog.com/c");
    });
  });
});
