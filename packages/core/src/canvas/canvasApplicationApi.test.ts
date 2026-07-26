import {
  canvasPersistedBuildSchema,
  canvasSourceVersionSchema,
  createLegacyReactCanvasProject,
} from "@posthog/shared/canvas-application";
import { describe, expect, it, vi } from "vitest";
import {
  CanvasApplicationApi,
  type CanvasVersionConflictError,
} from "./canvasApplicationApi";
import type { DesktopFsClient } from "./desktopFsClient";

const version = canvasSourceVersionSchema.parse({
  id: "version-1",
  parentVersionId: null,
  taskId: "task-1",
  taskRunId: "run-1",
  sourceHash: "a".repeat(64),
  sourceSize: 100,
  createdAt: 1,
});
const build = canvasPersistedBuildSchema.parse({
  id: "build-1",
  sourceVersionId: "version-1",
  status: "queued",
  diagnostics: [],
  createdAt: 1,
});

function service(response: Response) {
  const fetch = vi.fn().mockResolvedValue(response);
  return {
    api: new CanvasApplicationApi({ fetch } as unknown as DesktopFsClient),
    fetch,
  };
}

describe("CanvasApplicationApi", () => {
  it("publishes attributed source with an optimistic concurrency guard", async () => {
    const { api, fetch } = service(
      Response.json({ version, build }, { status: 201 }),
    );
    const project = createLegacyReactCanvasProject(
      "export default function App() { return null; }",
    );

    await expect(
      api.publish("canvas-1", {
        project,
        expectedCurrentVersionId: null,
        taskId: "task-1",
        taskRunId: "run-1",
        prompt: "Build it",
      }),
    ).resolves.toEqual({ version, build });
    expect(fetch).toHaveBeenCalledWith("canvas-1/canvas/source/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.stringContaining('"expectedCurrentVersionId":null'),
    });
  });

  it("returns null when a canvas has no application source", async () => {
    const { api } = service(new Response(null, { status: 404 }));
    await expect(api.getCurrentSource("canvas-1")).resolves.toBeNull();
  });

  it("validates source without publishing it", async () => {
    const { api, fetch } = service(
      Response.json({ ok: true, diagnostics: [], manifest: null }),
    );
    const project = createLegacyReactCanvasProject(
      "export default function App() { return null; }",
    );

    await expect(api.validate("canvas-1", project)).resolves.toEqual({
      ok: true,
      diagnostics: [],
      manifest: null,
    });
    expect(fetch).toHaveBeenCalledWith("canvas-1/canvas/validate/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(project),
    });
  });

  it("raises a typed conflict without losing the current head", async () => {
    const { api } = service(
      Response.json(
        {
          code: "version_conflict",
          detail: "Canvas changed",
          currentVersionId: "version-2",
        },
        { status: 409 },
      ),
    );

    await expect(
      api.publish("canvas-1", {
        project: createLegacyReactCanvasProject(
          "export default function App() { return null; }",
        ),
        expectedCurrentVersionId: "version-1",
        taskId: "task-1",
        taskRunId: "run-1",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CanvasVersionConflictError>>({
        name: "CanvasVersionConflictError",
        currentVersionId: "version-2",
      }),
    );
  });
});
