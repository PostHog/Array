import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactPreview } from "./ArtifactPreview";
import {
  artifactHtmlDocument,
  markdownDocument,
} from "./artifactPreviewDocument";

const previewBlob = new Blob(["<h1>Artifact content</h1>"], {
  type: "text/html",
});
const auth = vi.hoisted(() => ({ identity: "auth-1" as string | null }));
const useQuery = vi.hoisted(() => vi.fn());

vi.mock("@posthog/core/sessions/sessionService", () => ({
  SESSION_SERVICE: Symbol("SESSION_SERVICE"),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => ({}),
}));

vi.mock("@posthog/ui/features/auth/store", () => ({
  getAuthIdentity: vi.fn(),
  useAuthStateValue: () => auth.identity,
}));

vi.mock("@posthog/ui/features/auth/useCurrentUser", () => ({
  AUTH_SCOPED_QUERY_META: { authScoped: true },
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery,
}));

describe("ArtifactPreview", () => {
  beforeEach(() => {
    auth.identity = "auth-1";
    useQuery.mockReset();
    useQuery.mockReturnValue({
      data: previewBlob,
      isLoading: false,
      isError: false,
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  });

  it("scopes cached previews to the authenticated identity", () => {
    render(
      <ArtifactPreview
        taskId="task-1"
        runId="run-1"
        artifactId="artifact-1"
        name="report.html"
      />,
    );

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: [
          "artifactPreview",
          "auth-1",
          "task-1",
          "run-1",
          "artifact-1",
        ],
        enabled: true,
        meta: { authScoped: true },
      }),
    );
  });

  it("disables preview fetching without an authenticated identity", () => {
    auth.identity = null;
    render(
      <ArtifactPreview
        taskId="task-1"
        runId="run-1"
        artifactId="artifact-1"
        name="report.html"
      />,
    );

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, meta: { authScoped: true } }),
    );
  });

  it("shows artifact content in a fully sandboxed iframe", () => {
    render(
      <ArtifactPreview
        taskId="task-1"
        runId="run-1"
        artifactId="artifact-1"
        name="report.html"
      />,
    );

    const frame = screen.getByTitle("Preview of report.html");
    expect(frame).toHaveAttribute("src", "blob:preview");
    expect(frame).toHaveAttribute("sandbox", "");
  });

  it("renders GFM Markdown while escaping embedded HTML", () => {
    const document = markdownDocument(
      "# Report\n\n**Ready**\n\n| Name | Value |\n| --- | --- |\n| Cost | 12 |\n\n<script>alert('no')</script>",
    );

    expect(document).toContain("<h1>Report</h1>");
    expect(document).toContain("<strong>Ready</strong>");
    expect(document).toContain("<table>");
    expect(document).toContain("&lt;script&gt;");
    expect(document).not.toContain("<script>");
    expect(document).toContain("default-src &#39;none&#39;");
  });

  it("blocks network subresources in HTML artifacts", () => {
    const document = artifactHtmlDocument(
      '<!doctype html><img src="https://internal.example/secret">',
    );

    expect(document.indexOf("Content-Security-Policy")).toBeLessThan(
      document.indexOf("<img"),
    );
    expect(document).toContain("connect-src &#39;none&#39;");
    expect(document).toContain("frame-src &#39;none&#39;");
  });
});
