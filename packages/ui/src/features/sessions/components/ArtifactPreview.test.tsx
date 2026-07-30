import type { ResourceComment } from "@posthog/api-client/posthog-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactPreview } from "./ArtifactPreview";
import {
  artifactHtmlDocument,
  artifactPreviewBlob,
} from "./artifactPreviewDocument";

const previewBlob = new Blob(["<h1>Artifact content</h1>"], {
  type: "text/html",
});
const auth = vi.hoisted(() => ({ identity: "auth-1" as string | null }));
const artifactComments = vi.hoisted(() => ({
  data: [] as ResourceComment[],
}));
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

vi.mock("@posthog/ui/features/canvas/hooks/useOrgMembers", () => ({
  useOrgMembers: () => ({ members: [] }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery,
}));

vi.mock("./useComments", () => ({
  useCommentsQuery: () => ({
    data: artifactComments.data,
    isLoading: false,
  }),
  useCreateComment: () => ({ mutate: vi.fn(), isPending: false }),
  useSetCommentResolved: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("../../code-editor/components/CodeMirrorEditor", () => ({
  CodeMirrorEditor: ({ content }: { content: string }) => (
    <div data-testid="source-view">{content}</div>
  ),
}));

describe("ArtifactPreview", () => {
  beforeEach(() => {
    auth.identity = "auth-1";
    artifactComments.data = [];
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

  it("renders authored HTML in an opaque-origin annotation iframe", () => {
    useQuery.mockReturnValue({
      data: {
        kind: "html",
        html: "<style>h1{color:red}</style><h1>Artifact content</h1>",
      },
      isLoading: false,
      isError: false,
    });
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
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
    expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
  });

  it("keeps opaque formats in a fully sandboxed iframe", () => {
    render(
      <ArtifactPreview
        taskId="task-1"
        runId="run-1"
        artifactId="artifact-1"
        name="report.pdf"
      />,
    );

    const frame = screen.getByTitle("Preview of report.pdf");
    expect(frame).toHaveAttribute("src", "blob:preview");
    expect(frame).toHaveAttribute("sandbox", "");
  });

  it.each([
    ["image.png", "image/png"],
    ["image.jpg", "image/jpeg"],
    ["image.gif", "image/gif"],
    ["image.webp", "image/webp"],
    ["image.bmp", "image/bmp"],
    ["image.ico", "image/x-icon"],
    ["image.tiff", "image/tiff"],
    ["image.avif", "image/avif"],
  ])("normalizes %s served as octet-stream", async (name, mimeType) => {
    const blob = await artifactPreviewBlob(
      new Blob(["image"], { type: "application/octet-stream" }),
      name,
    );

    expect(blob.type).toBe(mimeType);
  });

  it("shows working image controls instead of an iframe", () => {
    useQuery.mockReturnValue({
      data: new Blob(["image"], { type: "image/png" }),
      isLoading: false,
      isError: false,
    });

    render(
      <ArtifactPreview
        taskId="task-1"
        runId="run-1"
        artifactId="artifact-1"
        name="image.png"
      />,
    );

    expect(screen.getByRole("img", { name: "image.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Zoom out" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Fit to view" }),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("Preview of image.png")).not.toBeInTheDocument();

    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    fireEvent.click(zoomOut);
    fireEvent.click(zoomOut);
    fireEvent.click(zoomOut);
    fireEvent.click(zoomOut);
    expect(screen.getByText("10%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fit to view" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("zooms with a trackpad pinch gesture", async () => {
    useQuery.mockReturnValue({
      data: new Blob(["image"], { type: "image/png" }),
      isLoading: false,
      isError: false,
    });

    render(
      <ArtifactPreview
        taskId="task-1"
        runId="run-1"
        artifactId="artifact-1"
        name="image.png"
      />,
    );

    const image = screen.getByRole("img", { name: "image.png" });
    const viewport = image.closest(".react-transform-wrapper");
    expect(viewport).not.toBeNull();
    fireEvent.wheel(viewport as Element, {
      ctrlKey: true,
      deltaY: -100,
      clientX: 100,
      clientY: 100,
    });

    await waitFor(() => {
      const percentage = Number.parseInt(
        screen.getByText(/%$/).textContent ?? "0",
        10,
      );
      expect(percentage).toBeGreaterThan(100);
    });
  });

  it("shows the preview error when an image cannot be decoded", () => {
    useQuery.mockReturnValue({
      data: new Blob(["not an image"], { type: "image/png" }),
      isLoading: false,
      isError: false,
    });

    render(
      <ArtifactPreview
        taskId="task-1"
        runId="run-1"
        artifactId="artifact-1"
        name="broken.png"
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "broken.png" }));
    expect(
      screen.getByText("This artifact can’t be previewed."),
    ).toBeInTheDocument();
  });

  it("renders Markdown artifacts with the file preview styling", () => {
    useQuery.mockReturnValue({
      data: "# Report\n\n**Ready**\n\n| Name | Value |\n| --- | --- |\n| Cost | 12 |",
      isLoading: false,
      isError: false,
    });

    const { container } = render(
      <ArtifactPreview
        taskId="task-1"
        runId="run-1"
        artifactId="artifact-1"
        name="report.md"
      />,
    );

    expect(screen.getByRole("heading", { name: "Report" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      container.querySelector(".plan-markdown.mx-auto"),
    ).toBeInTheDocument();
    expect(screen.getByText("report.md")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View source" }));

    expect(screen.getByTestId("source-view")).toHaveTextContent("# Report");
    expect(
      screen.getByRole("button", { name: "View preview" }),
    ).toBeInTheDocument();
  });

  it("does not render resolved comment highlights", () => {
    const root: ResourceComment = {
      id: "comment-1",
      created_by: null,
      content: "Review this",
      created_at: "2026-01-01T00:00:00Z",
      item_id: "artifact-1",
      item_context: {
        anchor: {
          kind: "text",
          quote: "Report",
          prefix: "# ",
          suffix: "",
          start: 2,
          end: 8,
        },
      },
      scope: "task_artifact",
      source_comment: null,
      completed_at: null,
    };
    artifactComments.data = [
      root,
      {
        ...root,
        id: "state-1",
        content: "Resolved this thread",
        created_at: "2026-01-01T00:01:00Z",
        source_comment: root.id,
        item_context: {
          anchor: { kind: "document" },
          threadState: "resolved",
        },
      },
    ];
    useQuery.mockReturnValue({
      data: "# Report",
      isLoading: false,
      isError: false,
    });

    render(
      <ArtifactPreview
        taskId="task-1"
        runId="run-1"
        artifactId="artifact-1"
        name="report.md"
      />,
    );

    expect(screen.queryByLabelText("Open comment thread")).toBeNull();
  });

  // Opening an artifact from the task's centralized comment list has to land on
  // the thread that was clicked, even though comments load after the preview.
  it("selects the thread it was opened from", async () => {
    artifactComments.data = [
      {
        id: "comment-1",
        created_by: null,
        content: "Tighten this summary",
        created_at: "2026-01-01T00:00:00Z",
        item_id: "artifact-1",
        item_context: { anchor: { kind: "document" } },
        scope: "task_artifact",
        source_comment: null,
        completed_at: null,
      },
    ];
    useQuery.mockReturnValue({
      data: "# Report",
      isLoading: false,
      isError: false,
    });

    render(
      <ArtifactPreview
        taskId="task-1"
        runId="run-1"
        artifactId="artifact-1"
        name="report.md"
        initialCommentId="comment-1"
      />,
    );

    // The sidebar opens itself on the deep-linked thread.
    await waitFor(() =>
      expect(screen.getByText("Tighten this summary")).toBeTruthy(),
    );
  });

  it("preserves authored styles and injects the inline-comment bridge", () => {
    const document = artifactHtmlDocument(
      '<!doctype html><html><head><style>.card{color:red}</style></head><body><div class="card" style="font-size:20px">Report</div></body></html>',
      "test-channel",
    );

    expect(document).toContain("<style>.card{color:red}</style>");
    expect(document).toContain('style="font-size:20px"');
    expect(document).toContain("__POSTHOG_ARTIFACT_COMMENT_BRIDGE__");
    expect(document).toContain("💬 Comment");
    expect(document).toContain('var CHANNEL="test-channel"');
    expect(document).toContain('d.type==="locate"');
    expect(document).toContain("scrollIntoView");
  });

  it("keeps sensitive capabilities blocked in HTML artifacts", () => {
    const document = artifactHtmlDocument(
      '<!doctype html><img src="https://images.example/report.png">',
    );

    expect(document.indexOf("Content-Security-Policy")).toBeLessThan(
      document.indexOf("<img"),
    );
    expect(document).toContain("connect-src &#39;none&#39;");
    expect(document).toContain("frame-src &#39;none&#39;");
    expect(document).toContain("form-action &#39;none&#39;");
    expect(document).toContain("https:");
  });
});
