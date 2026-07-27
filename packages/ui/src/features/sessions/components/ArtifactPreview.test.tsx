import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactPreview } from "./ArtifactPreview";

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
});
