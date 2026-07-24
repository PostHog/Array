import { Theme } from "@radix-ui/themes";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudArtifactDownloads } from "./CloudArtifactDownloads";

const getCloudAttachmentPreviewUrl = vi.fn();

vi.mock("@posthog/core/sessions/sessionService", () => ({
  SESSION_SERVICE: Symbol("SESSION_SERVICE"),
}));

vi.mock("@posthog/di/react", () => ({
  useService: () => ({ getCloudAttachmentPreviewUrl }),
}));

vi.mock("@posthog/ui/features/sessions/sessionStore", () => ({
  useSessionSelector: () => undefined,
}));

const task = {
  id: "task-1",
  latest_run: {
    id: "run-1",
    artifacts: [
      {
        id: "output-1",
        name: "report.pdf",
        type: "output",
        size: 12_000,
        storage_path: "tasks/run-1/report.pdf",
      },
      {
        id: "internal-1",
        name: "handoff.pack",
        type: "artifact",
        storage_path: "tasks/run-1/handoff.pack",
      },
    ],
  },
} as never;

describe("CloudArtifactDownloads", () => {
  beforeEach(() => {
    getCloudAttachmentPreviewUrl.mockReset();
  });

  it("shows output artifacts and opens their download URL", async () => {
    getCloudAttachmentPreviewUrl.mockResolvedValue(
      "https://files.example/report.pdf",
    );
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <Theme>
        <CloudArtifactDownloads taskId="task-1" task={task} />
      </Theme>,
    );

    expect(screen.getByText("report.pdf")).toBeInTheDocument();
    expect(screen.getByText("12 KB")).toBeInTheDocument();
    expect(screen.queryByText("handoff.pack")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    await waitFor(() =>
      expect(open).toHaveBeenCalledWith(
        "https://files.example/report.pdf",
        "_blank",
        "noopener,noreferrer",
      ),
    );
    expect(getCloudAttachmentPreviewUrl).toHaveBeenCalledWith(
      "task-1",
      "run-1",
      "output-1",
    );
  });
});
