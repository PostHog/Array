export interface CloudArtifactUploadRequest {
  name: string;
  type: "user_attachment";
  size: number;
  content_type?: string;
  source?: string;
}

export interface CloudArtifactPresignedPost {
  url: string;
  fields: Record<string, string>;
}

export interface PreparedCloudArtifact extends CloudArtifactUploadRequest {
  id: string;
  presigned_post: CloudArtifactPresignedPost;
}

export interface FinalizedCloudArtifact {
  id: string;
}

export interface CloudArtifactClient {
  prepareTaskStagedArtifactUploads(
    taskId: string,
    artifacts: CloudArtifactUploadRequest[],
  ): Promise<PreparedCloudArtifact[]>;
  finalizeTaskStagedArtifactUploads(
    taskId: string,
    artifacts: PreparedCloudArtifact[],
  ): Promise<FinalizedCloudArtifact[]>;
  prepareTaskRunArtifactUploads(
    taskId: string,
    runId: string,
    artifacts: CloudArtifactUploadRequest[],
  ): Promise<PreparedCloudArtifact[]>;
  finalizeTaskRunArtifactUploads(
    taskId: string,
    runId: string,
    artifacts: PreparedCloudArtifact[],
  ): Promise<FinalizedCloudArtifact[]>;
}

export const CLOUD_ARTIFACT_SERVICE = Symbol.for(
  "posthog.core.sessions.cloudArtifactService",
);
export const CLOUD_ARTIFACT_READ_FILE_AS_BASE64 = Symbol.for(
  "posthog.core.sessions.cloudArtifactReadFileAsBase64",
);
