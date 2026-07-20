import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import { PostHogAPIClient } from "../../../posthog-api";
import { resolveSandboxPosthogApi } from "../../../signed-commit-artefacts";
import { defineLocalTool, type LocalToolResult } from "../registry";

/**
 * Local tools for working on freeform canvases (desktop-fs `dashboard` rows)
 * as scratch files, so the agent edits the source incrementally with its
 * native file tools instead of regenerating (or transcribing) the whole file:
 *
 * - `canvas_checkout` fetches the canvas, writes `meta.code` to a
 *   deterministic scratch path tool-side (no model transcription), and stashes
 *   the fetched `currentVersionId` as the publish-time concurrency base.
 * - `canvas_publish` reads the scratch file from disk (again, no
 *   transcription), verifies the canvas hasn't moved past the stashed base
 *   (a concurrent edit or user undo), appends a full-file version snapshot,
 *   and PATCHes the merged meta — mirroring `dashboardsService.saveFreeform`
 *   in `@posthog/core`, including the linear-discard of any redo tail.
 *
 * The check-then-PATCH guard is tool-side and therefore not atomic; it shrinks
 * the clobber window from "the whole generation turn" to milliseconds. A
 * server-side `base_version` check on the desktop-fs PATCH remains the
 * follow-up that closes it completely.
 *
 * Credentials come from the sandbox environment (see
 * `resolveSandboxPosthogApi`), so this works identically from the Claude
 * in-process server and the Codex stdio child.
 */

// Deliberately outside any workspace: scratch files never show up in
// changed-file diff panels or `git status` (a canvas task can lazily attach a
// repo), and the canvas id keeps concurrent generations from colliding.
export const CANVAS_SCRATCH_ROOT = "/tmp/posthog-canvas";

export function canvasScratchDir(canvasId: string): string {
  return path.join(CANVAS_SCRATCH_ROOT, canvasId);
}

export function canvasScratchFile(canvasId: string): string {
  return path.join(canvasScratchDir(canvasId), "canvas.tsx");
}

function baseVersionMarkerFile(canvasId: string): string {
  return path.join(canvasScratchDir(canvasId), ".base-version.json");
}

interface CanvasVersion {
  id: string;
  code: string;
  context?: string;
  prompt?: string;
  createdAt: number;
}

interface CanvasMeta {
  code?: string;
  versions?: CanvasVersion[];
  currentVersionId?: string;
  updatedAt?: number;
  [key: string]: unknown;
}

interface CanvasFsEntry {
  id: string;
  path: string;
  type?: string;
  meta?: CanvasMeta | null;
}

interface BaseVersionMarker {
  versionId?: string;
  fetchedAt: number;
}

function createClient(): PostHogAPIClient | undefined {
  const api = resolveSandboxPosthogApi();
  if (!api) return undefined;
  return new PostHogAPIClient({
    apiUrl: api.apiUrl,
    projectId: api.projectId,
    getApiKey: () => api.apiKey,
  });
}

async function fetchCanvasEntry(canvasId: string): Promise<CanvasFsEntry> {
  const client = createClient();
  if (!client) {
    throw new Error("No PostHog credentials available in this session.");
  }
  const entry = await client.getDesktopFsEntry<CanvasFsEntry>(canvasId);
  if (!entry) {
    throw new Error(
      `Canvas ${canvasId} not found. Check the id — it should be a desktop-fs dashboard row id.`,
    );
  }
  if (entry.type !== "dashboard") {
    throw new Error(
      `Entry ${canvasId} is type "${entry.type}", not a canvas ("dashboard").`,
    );
  }
  return entry;
}

async function patchCanvasMeta(
  canvasId: string,
  meta: CanvasMeta,
): Promise<void> {
  const client = createClient();
  if (!client) {
    throw new Error("No PostHog credentials available in this session.");
  }
  await client.patchDesktopFsEntryMeta(canvasId, meta);
}

function readMarker(canvasId: string): BaseVersionMarker | undefined {
  try {
    return JSON.parse(
      readFileSync(baseVersionMarkerFile(canvasId), "utf8"),
    ) as BaseVersionMarker;
  } catch {
    return undefined;
  }
}

function writeMarker(canvasId: string, marker: BaseVersionMarker): void {
  mkdirSync(canvasScratchDir(canvasId), { recursive: true });
  writeFileSync(baseVersionMarkerFile(canvasId), JSON.stringify(marker));
}

/**
 * Compose the published meta from a freshly-fetched entry: verify the base,
 * truncate any redo tail past the current pointer (linear-discard, matching
 * the client's undo semantics in `freeformSchemas.ts`), and append the new
 * full-file snapshot. Pure — exported for tests.
 */
export function composePublishedMeta(input: {
  freshMeta: CanvasMeta;
  baseVersionId: string | undefined;
  code: string;
  prompt?: string;
  now: number;
}): { ok: true; meta: CanvasMeta; versionId: string } | { ok: false } {
  const { freshMeta, baseVersionId, code, prompt, now } = input;
  if ((freshMeta.currentVersionId ?? undefined) !== baseVersionId) {
    return { ok: false };
  }
  const versions = freshMeta.versions ?? [];
  const pointer = baseVersionId
    ? versions.findIndex((v) => v.id === baseVersionId)
    : -1;
  const kept = pointer >= 0 ? versions.slice(0, pointer + 1) : [];
  const version: CanvasVersion = {
    id: randomUUID(),
    code,
    ...(prompt ? { prompt } : {}),
    createdAt: now,
  };
  return {
    ok: true,
    versionId: version.id,
    meta: {
      ...freshMeta,
      code,
      versions: [...kept, version],
      currentVersionId: version.id,
      updatedAt: now,
    },
  };
}

function errorResult(text: string): LocalToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

const CONFLICT_MESSAGE = (canvasId: string) =>
  `version-conflict: the canvas changed since your checkout (a concurrent edit, or the user's undo). ` +
  `Recover: call canvas_checkout with id "${canvasId}" again (it re-seeds the scratch file from the live source), ` +
  `re-apply your edits to it, then call canvas_publish again.`;

export const canvasCheckoutTool = defineLocalTool({
  name: "canvas_checkout",
  description:
    "Check out a PostHog canvas (a freeform React desktop-fs dashboard) for editing: fetches the live " +
    "source, writes it to a local scratch file, and records the version your edits are based on. " +
    "Returns the file path. Edit that file with your normal file-editing tools (targeted edits — do not " +
    "regenerate it wholesale), then call canvas_publish to save. Always start canvas work with this tool.",
  schema: {
    id: z.string().describe("The canvas (desktop-fs dashboard row) id."),
  },
  alwaysLoad: true,
  isEnabled: () => resolveSandboxPosthogApi() !== undefined,
  handler: async (_ctx, args): Promise<LocalToolResult> => {
    try {
      const entry = await fetchCanvasEntry(args.id);
      const file = canvasScratchFile(args.id);
      const code = entry.meta?.code ?? "";
      mkdirSync(canvasScratchDir(args.id), { recursive: true });
      writeFileSync(file, code);
      writeMarker(args.id, {
        versionId: entry.meta?.currentVersionId,
        fetchedAt: Date.now(),
      });
      const lines = code ? code.split("\n").length : 0;
      const text = code
        ? `Checked out canvas "${entry.path}" to ${file} (${lines} lines, base version ${
            entry.meta?.currentVersionId ?? "none"
          }).\nApply your changes by EDITING that file (targeted edits), then call canvas_publish with id "${args.id}".`
        : `Canvas "${entry.path}" is empty. Author the complete single-file React app at ${file}, then call canvas_publish with id "${args.id}".`;
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return errorResult(
        `canvas_checkout failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});

export const canvasPublishTool = defineLocalTool({
  name: "canvas_publish",
  description:
    "Publish the checked-out canvas: reads the scratch file written by canvas_checkout, verifies the " +
    "canvas hasn't changed since checkout, and saves the file as the canvas's new live version. Call " +
    "exactly once when the edit is complete. On a version-conflict error, re-run canvas_checkout, " +
    "re-apply your edits, and publish again.",
  schema: {
    id: z.string().describe("The canvas (desktop-fs dashboard row) id."),
    prompt: z
      .string()
      .optional()
      .describe(
        "One short sentence describing the change, stored on the version history entry.",
      ),
  },
  alwaysLoad: true,
  isEnabled: () => resolveSandboxPosthogApi() !== undefined,
  handler: async (_ctx, args): Promise<LocalToolResult> => {
    let code: string;
    try {
      code = readFileSync(canvasScratchFile(args.id), "utf8");
    } catch {
      return errorResult(
        `canvas_publish failed: no scratch file for canvas "${args.id}". Call canvas_checkout first, edit the file it returns, then publish.`,
      );
    }
    if (!code.trim()) {
      return errorResult(
        `canvas_publish failed: the scratch file for canvas "${args.id}" is empty.`,
      );
    }
    const marker = readMarker(args.id);
    if (!marker) {
      return errorResult(
        `canvas_publish failed: no checkout record for canvas "${args.id}". Call canvas_checkout first.`,
      );
    }
    try {
      const fresh = await fetchCanvasEntry(args.id);
      const composed = composePublishedMeta({
        freshMeta: fresh.meta ?? {},
        baseVersionId: marker.versionId,
        code,
        prompt: args.prompt,
        now: Date.now(),
      });
      if (!composed.ok) {
        return errorResult(
          `canvas_publish failed: ${CONFLICT_MESSAGE(args.id)}`,
        );
      }
      await patchCanvasMeta(args.id, composed.meta);
      // Advance the base so a follow-up publish in the same session works
      // without a re-checkout.
      writeMarker(args.id, {
        versionId: composed.versionId,
        fetchedAt: Date.now(),
      });
      return {
        content: [
          {
            type: "text",
            text: `Published canvas "${args.id}" (new version ${composed.versionId}). The canvas is live; do not paste the code into chat.`,
          },
        ],
      };
    } catch (err) {
      return errorResult(
        `canvas_publish failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});
