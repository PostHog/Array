import { describe, expect, it, vi } from "vitest";
import {
  copyFromContextMenu,
  getGithubRefUrlFromEventTarget,
  resolveCopyText,
} from "./copyContextTarget";

function buildDom(): {
  icon: HTMLElement;
  label: HTMLElement;
  chip: HTMLElement;
  outside: HTMLElement;
} {
  document.body.innerHTML = `
    <div id="conversation">
      <span data-github-ref-url="https://github.com/PostHog/posthog/pull/23985">
        <button id="chip"><svg id="icon"></svg><span id="label">PostHog/posthog#23985</span></button>
      </span>
      <p id="outside">just some prose</p>
    </div>`;
  return {
    icon: document.getElementById("icon") as HTMLElement,
    label: document.getElementById("label") as HTMLElement,
    chip: document.getElementById("chip") as HTMLElement,
    outside: document.getElementById("outside") as HTMLElement,
  };
}

describe("getGithubRefUrlFromEventTarget", () => {
  it("resolves the chip URL when the right-click lands on a nested icon", () => {
    const { icon } = buildDom();
    expect(getGithubRefUrlFromEventTarget(icon)).toBe(
      "https://github.com/PostHog/posthog/pull/23985",
    );
  });

  it("resolves the chip URL when the right-click lands on the label", () => {
    const { label } = buildDom();
    expect(getGithubRefUrlFromEventTarget(label)).toBe(
      "https://github.com/PostHog/posthog/pull/23985",
    );
  });

  it("returns null when the right-click is on non-chip prose", () => {
    const { outside } = buildDom();
    expect(getGithubRefUrlFromEventTarget(outside)).toBeNull();
  });

  it("returns null for a missing or non-element target", () => {
    expect(getGithubRefUrlFromEventTarget(null)).toBeNull();
  });
});

describe("resolveCopyText", () => {
  it("prefers a captured chip URL over the text selection", () => {
    expect(
      resolveCopyText("https://github.com/PostHog/posthog/pull/1", "selected"),
    ).toBe("https://github.com/PostHog/posthog/pull/1");
  });

  it("falls back to the text selection when there is no chip URL", () => {
    expect(resolveCopyText(null, "selected words")).toBe("selected words");
  });

  it("returns null when there is neither a chip URL nor a selection", () => {
    expect(resolveCopyText(null, "")).toBeNull();
    expect(resolveCopyText(null, undefined)).toBeNull();
  });
});

describe("copyFromContextMenu", () => {
  it("defers the clipboard write until after the current task (focus race)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    copyFromContextMenu("https://github.com/PostHog/posthog/pull/1");

    // Not written synchronously while the menu is still dismissing.
    expect(writeText).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://github.com/PostHog/posthog/pull/1",
      ),
    );
  });

  it("invokes onSuccess after the deferred write resolves", async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    copyFromContextMenu("text", { onSuccess, onError });

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it("invokes onError when the deferred write rejects", async () => {
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockRejectedValue(new Error("Document is not focused")),
      },
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();

    copyFromContextMenu("text", { onSuccess, onError });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
