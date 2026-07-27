import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import { Spinner } from "@posthog/quill";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);

function extension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function markdownDocument(markdown: string): string {
  return `<!doctype html><meta charset="utf-8"><style>html{color-scheme:light dark}body{margin:0;padding:32px;font:15px/1.6 system-ui,sans-serif}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>${escapeHtml(markdown)}</pre>`;
}

export function ArtifactPreview({
  taskId,
  runId,
  artifactId,
  name,
}: {
  taskId: string;
  runId: string;
  artifactId: string;
  name: string;
}) {
  const sessionService = useService<SessionService>(SESSION_SERVICE);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["artifactPreview", taskId, runId, artifactId],
    queryFn: async () => {
      const url = await sessionService.getCloudAttachmentPreviewUrl(
        taskId,
        runId,
        artifactId,
      );
      if (!url) throw new Error("Artifact is unavailable");
      const response = await fetch(url);
      if (!response.ok) throw new Error("Artifact preview failed");
      const blob = await response.blob();
      if (MARKDOWN_EXTENSIONS.has(extension(name))) {
        return new Blob([markdownDocument(await blob.text())], {
          type: "text/html",
        });
      }
      if (extension(name) === "html" || extension(name) === "htm") {
        return new Blob([await blob.text()], { type: "text/html" });
      }
      return blob;
    },
    staleTime: Infinity,
    retry: false,
  });
  const previewUrl = useMemo(
    () => (data ? URL.createObjectURL(data) : null),
    [data],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const title = useMemo(() => `Preview of ${name}`, [name]);
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (isError || !previewUrl) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        This artifact can’t be previewed.
      </div>
    );
  }
  return (
    <iframe
      className="h-full w-full border-0 bg-white"
      sandbox=""
      src={previewUrl}
      title={title}
    />
  );
}
