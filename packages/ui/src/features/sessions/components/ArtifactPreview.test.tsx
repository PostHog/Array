import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactPreview, markdownDocument } from "./ArtifactPreview";

const previewBlob = new Blob(["<h1>Artifact content</h1>"], {
  type: "text/html",
});

vi.mock("@posthog/core/sessions/sessionService", () => ({
  SESSION_SERVICE: Symbol("SESSION_SERVICE"),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => ({}),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: previewBlob, isLoading: false, isError: false }),
}));

describe("ArtifactPreview", () => {
  beforeEach(() => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
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
  });
});
