import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { freeformSystemPromptFor } from "@posthog/shared/canvas-freeform-prompt";
import { FREEFORM_STARTER_CODE } from "@posthog/shared/canvas-freeform-starter";
import { z } from "zod";
import {
  DesktopCanvasVersionConflictError,
  PostHogAPIClient,
} from "../../../posthog-api";
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
 *   transcription) and publishes through the desktop-fs canvas action, which
 *   owns version composition server-side. The stashed base rides along as
 *   `expected_current_version_id`, so a publish based on a stale read (a
 *   concurrent edit, or a user's undo) is rejected atomically with a version
 *   conflict instead of clobbering the newer head.
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

interface CanvasMeta {
  code?: string;
  currentVersionId?: string;
  templateId?: string;
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

// Create-if-missing for `canvas_checkout`: an agent working from a normal task
// (not the channel generate bar) can start a canvas in one call instead of
// chaining the raw desktop-fs create tool first.
async function createCanvasEntry(
  name: string | undefined,
  parentPath: string | undefined,
): Promise<CanvasFsEntry> {
  if (!name?.trim()) {
    throw new Error(
      "pass `id` to edit an existing canvas, or `name` to create a new one.",
    );
  }
  // A canvas must live under a channel folder — creating it at the top level
  // (no parentPath) makes an orphan that never shows in any channel. The task's
  // channel name is in the `<channel_context channel="…">` element of the
  // prompt; the agent passes it as parentPath. Refuse rather than orphan.
  if (!parentPath?.trim()) {
    throw new Error(
      "a new canvas needs a channel to live in: pass `parentPath` set to the " +
        'channel this task is in (its name, from the `<channel_context channel="…">` ' +
        "element of your prompt). Without a channel the canvas can't be placed. If " +
        "there is no channel context, ask the user which channel to create it in.",
    );
  }
  const client = createClient();
  if (!client) {
    throw new Error("No PostHog credentials available in this session.");
  }
  return client.createDesktopCanvas<CanvasFsEntry>({
    name: name.trim(),
    parentPath: parentPath.trim(),
  });
}

// The freeform authoring rules (allowed imports, the `ph` data shim, style
// rules) the channel generate bar injects up front. Returned on checkout so an
// agent editing a canvas from any task authors valid source; an empty canvas
// also gets the known-good starter scaffold to build on.
function authoringContract(
  templateId: string | undefined,
  isEmpty: boolean,
): string {
  const contract = freeformSystemPromptFor(templateId);
  const starter = isEmpty
    ? `\n\nStarter scaffold — write this working baseline to the scratch file first, then build by editing it:\n\n\`\`\`tsx\n${FREEFORM_STARTER_CODE}\n\`\`\``
    : "";
  return `Authoring contract for this canvas (imports, the \`ph\` data shim, and style rules):\n\n${contract}${starter}`;
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
    "Check out a PostHog canvas (a freeform React desktop-fs dashboard) for editing. Pass `id` to edit " +
    "an existing canvas, or omit `id` and pass `name` to create a fresh one. Fetches (or creates) the " +
    "canvas, writes its source to a local scratch file, records the base version for the publish-time " +
    "concurrency guard, and returns the scratch path plus the authoring contract to follow. Edit that " +
    "file with your normal file-editing tools, then call canvas_publish. Always start canvas work with " +
    "this tool.",
  schema: {
    id: z
      .string()
      .optional()
      .describe(
        "Existing canvas (desktop-fs dashboard row) id to edit. Omit to create a new canvas via `name`.",
      ),
    name: z
      .string()
      .optional()
      .describe(
        "Name for a NEW canvas when `id` is omitted — creates it, then checks it out.",
      ),
    parentPath: z
      .string()
      .optional()
      .describe(
        'Required when creating (no `id`): the channel the canvas belongs to — its name, from the `<channel_context channel="…">` element of your prompt. The canvas is created at "<parentPath>/<name>"; omitting it is rejected (a canvas must live under a channel).',
      ),
  },
  alwaysLoad: true,
  autoApprove: true,
  isEnabled: () => resolveSandboxPosthogApi() !== undefined,
  handler: async (_ctx, args): Promise<LocalToolResult> => {
    try {
      const entry = args.id
        ? await fetchCanvasEntry(args.id)
        : await createCanvasEntry(args.name, args.parentPath);
      const canvasId = entry.id;
      const file = canvasScratchFile(canvasId);
      const code = entry.meta?.code ?? "";
      mkdirSync(canvasScratchDir(canvasId), { recursive: true });
      writeFileSync(file, code);
      writeMarker(canvasId, {
        versionId: entry.meta?.currentVersionId,
        fetchedAt: Date.now(),
      });
      const lines = code ? code.split("\n").length : 0;
      const header = code
        ? `Checked out canvas "${entry.path}" (id ${canvasId}) to ${file} (${lines} lines, base version ${
            entry.meta?.currentVersionId ?? "none"
          }). Edit that file, then call canvas_publish with id "${canvasId}".`
        : `Canvas "${entry.path}" (id ${canvasId}) is empty — author the complete single-file React app at ${file}, then call canvas_publish with id "${canvasId}".`;
      const text = `${header}\n\n${authoringContract(entry.meta?.templateId, !code)}`;
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
    "Publish the checked-out canvas: reads the scratch file written by canvas_checkout and saves it as " +
    "the canvas's new live version, guarded against the canvas having changed since checkout. Call " +
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
    const client = createClient();
    if (!client) {
      return errorResult(
        "canvas_publish failed: no PostHog credentials available in this session.",
      );
    }
    try {
      const entry = await client.publishDesktopCanvas<CanvasFsEntry>(args.id, {
        code,
        prompt: args.prompt,
        expectedCurrentVersionId: marker.versionId ?? null,
      });
      // Advance the base so a follow-up publish in the same session works
      // without a re-checkout.
      const newVersionId = entry.meta?.currentVersionId;
      writeMarker(args.id, { versionId: newVersionId, fetchedAt: Date.now() });
      return {
        content: [
          {
            type: "text",
            text: `Published canvas "${args.id}"${
              newVersionId ? ` (new version ${newVersionId})` : ""
            }. The canvas is live; do not paste the code into chat.`,
          },
        ],
      };
    } catch (err) {
      if (err instanceof DesktopCanvasVersionConflictError) {
        return errorResult(
          `canvas_publish failed: ${CONFLICT_MESSAGE(args.id)}`,
        );
      }
      return errorResult(
        `canvas_publish failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  },
});
