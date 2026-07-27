import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import { Spinner } from "@posthog/quill";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const MARKDOWN_EXTENSIONS = new Set(["md", "mdx", "markdown"]);

function extension(filename: string): string {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function markdownDocument(markdown: string): string {
  const content = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>,
  );
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>
    :root{font:15px/1.6 system-ui,sans-serif;color-scheme:light dark}body{box-sizing:border-box;margin:0 auto;max-width:900px;padding:32px;color:CanvasText;background:Canvas}h1,h2{border-bottom:1px solid color-mix(in srgb,CanvasText 18%,transparent);padding-bottom:.3em}h1{font-size:2em}h2{font-size:1.5em}h3{font-size:1.25em}a{color:LinkText}blockquote{margin-left:0;padding-left:1em;border-left:4px solid color-mix(in srgb,CanvasText 25%,transparent);color:GrayText}pre,code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}code{border-radius:4px;background:color-mix(in srgb,CanvasText 8%,transparent);padding:.15em .3em}pre{overflow:auto;border-radius:6px;background:color-mix(in srgb,CanvasText 8%,transparent);padding:16px}pre code{background:none;padding:0}table{border-spacing:0;border-collapse:collapse}th,td{border:1px solid color-mix(in srgb,CanvasText 20%,transparent);padding:6px 12px}img{max-width:100%}hr{border:0;border-top:1px solid color-mix(in srgb,CanvasText 20%,transparent)}
  </style></head><body>${content}</body></html>`;
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
