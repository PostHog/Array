import {
  type CanvasHistory,
  type CanvasPersistedBuild,
  type CanvasPublishRequest,
  type CanvasPublishResult,
  type CanvasSourceSnapshot,
  canvasHistorySchema,
  canvasPersistedBuildSchema,
  canvasPublishRequestSchema,
  canvasPublishResultSchema,
  canvasSourceSnapshotSchema,
  canvasVersionConflictSchema,
} from "@posthog/shared/canvas-application";
import { inject, injectable } from "inversify";
import { DESKTOP_FS_CLIENT, type DesktopFsClient } from "./desktopFsClient";

export const CANVAS_APPLICATION_API = Symbol.for(
  "posthog.core.canvas.applicationApi",
);

export class CanvasVersionConflictError extends Error {
  readonly name = "CanvasVersionConflictError";

  constructor(
    message: string,
    readonly currentVersionId: string | null,
  ) {
    super(message);
  }
}

@injectable()
export class CanvasApplicationApi {
  constructor(
    @inject(DESKTOP_FS_CLIENT) private readonly fs: DesktopFsClient,
  ) {}

  async getCurrentSource(
    canvasId: string,
  ): Promise<CanvasSourceSnapshot | null> {
    const response = await this.fs.fetch(
      `${encodeURIComponent(canvasId)}/canvas/source/`,
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Failed to load canvas source (${response.status})`);
    }
    return canvasSourceSnapshotSchema.parse(await response.json());
  }

  async publish(
    canvasId: string,
    input: CanvasPublishRequest,
  ): Promise<CanvasPublishResult> {
    const payload = canvasPublishRequestSchema.parse(input);
    const response = await this.fs.fetch(
      `${encodeURIComponent(canvasId)}/canvas/source/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    if (response.status === 409) {
      const conflict = canvasVersionConflictSchema.parse(await response.json());
      throw new CanvasVersionConflictError(
        conflict.detail,
        conflict.currentVersionId,
      );
    }
    if (!response.ok) {
      throw new Error(`Failed to publish canvas source (${response.status})`);
    }
    return canvasPublishResultSchema.parse(await response.json());
  }

  async history(canvasId: string): Promise<CanvasHistory> {
    const response = await this.fs.fetch(
      `${encodeURIComponent(canvasId)}/canvas/history/`,
    );
    if (!response.ok) {
      throw new Error(`Failed to load canvas history (${response.status})`);
    }
    return canvasHistorySchema.parse(await response.json());
  }

  async getBuild(
    canvasId: string,
    buildId: string,
  ): Promise<CanvasPersistedBuild> {
    const response = await this.fs.fetch(
      `${encodeURIComponent(canvasId)}/canvas/builds/${encodeURIComponent(buildId)}/`,
    );
    if (!response.ok) {
      throw new Error(`Failed to load canvas build (${response.status})`);
    }
    return canvasPersistedBuildSchema.parse(await response.json());
  }
}
