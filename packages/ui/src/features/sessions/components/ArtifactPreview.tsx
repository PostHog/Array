import {
  SESSION_SERVICE,
  type SessionService,
} from "@posthog/core/sessions/sessionService";
import { useService } from "@posthog/di/react";
import { Spinner } from "@posthog/quill";
import { isAllowedImageMimeType } from "@posthog/shared";
import {
  getAuthIdentity,
  useAuthStateValue,
} from "@posthog/ui/features/auth/store";
import { AUTH_SCOPED_QUERY_META } from "@posthog/ui/features/auth/useCurrentUser";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { ZoomableImage } from "../../../primitives/SafeImagePreview";
import { artifactPreviewBlob } from "./artifactPreviewDocument";

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
  const authIdentity = useAuthStateValue(getAuthIdentity);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["artifactPreview", authIdentity, taskId, runId, artifactId],
    queryFn: async () => {
      const url = await sessionService.getCloudAttachmentPreviewUrl(
        taskId,
        runId,
        artifactId,
      );
      if (!url) throw new Error("Artifact is unavailable");
      const response = await fetch(url);
      if (!response.ok) throw new Error("Artifact preview failed");
      return artifactPreviewBlob(await response.blob(), name);
    },
    enabled: authIdentity !== null,
    staleTime: Infinity,
    retry: false,
    meta: AUTH_SCOPED_QUERY_META,
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
  if (data && isAllowedImageMimeType(data.type)) {
    return (
      <ZoomableImage
        src={previewUrl}
        alt={name}
        controls
        className="size-full bg-(--gray-2) p-4"
      />
    );
  }
  return (
    <iframe
      className="h-full w-full border-0 bg-white"
      sandbox=""
      src={previewUrl}
      title={`Preview of ${name}`}
    />
  );
}
