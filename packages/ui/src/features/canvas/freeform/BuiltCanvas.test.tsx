import { openExternalUrl } from "@posthog/ui/shell/openExternal";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BuiltCanvas } from "./BuiltCanvas";

vi.mock("@posthog/ui/shell/openExternal", () => ({
  openExternalUrl: vi.fn(),
}));

describe("BuiltCanvas", () => {
  it("loads an immutable artifact without granting origin or popup access", () => {
    render(
      <BuiltCanvas
        artifactUrl="https://usercontent.example/build/index.html"
        onDataRequest={vi.fn()}
      />,
    );

    expect(screen.getByTitle("Canvas")).toHaveAttribute(
      "src",
      "https://usercontent.example/build/index.html",
    );
    expect(screen.getByTitle("Canvas")).toHaveAttribute(
      "sandbox",
      "allow-scripts",
    );
    expect(screen.getByTitle("Canvas")).toHaveAttribute(
      "referrerpolicy",
      "no-referrer",
    );
  });

  it("brokers validated data requests back to the artifact", async () => {
    const onDataRequest = vi.fn().mockResolvedValue({ results: [1] });
    render(
      <BuiltCanvas
        artifactUrl="https://usercontent.example/build/index.html"
        onDataRequest={onDataRequest}
      />,
    );
    const iframe = screen.getByTitle("Canvas") as HTMLIFrameElement;
    const contentWindow = iframe.contentWindow;
    if (!contentWindow) throw new Error("Canvas iframe has no content window");
    const postMessage = vi.spyOn(contentWindow, "postMessage");

    window.dispatchEvent(
      new MessageEvent("message", {
        source: contentWindow,
        data: {
          channel: "posthog-canvas",
          type: "data-request",
          id: "1",
          method: "loadInsight",
          payload: { shortId: "allowed" },
        },
      }),
    );

    await waitFor(() =>
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "posthog-canvas",
          type: "data-response",
          id: "1",
          ok: true,
        }),
        "*",
      ),
    );
  });

  it("does not open external URLs without focus", () => {
    render(
      <BuiltCanvas
        artifactUrl="https://usercontent.example/build/index.html"
        onDataRequest={vi.fn()}
      />,
    );
    const iframe = screen.getByTitle("Canvas") as HTMLIFrameElement;
    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        data: {
          channel: "posthog-canvas",
          type: "open-external",
          url: "https://posthog.com/docs",
        },
      }),
    );

    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});
