import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import {
  FREEFORM_TEMPLATE_ID,
  freeformSystemPromptFor,
} from "@posthog/shared/canvas-freeform-prompt";
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

// The app files every channel task as a desktop-fs `task` row at
// `<channelFolder>/<title>` with `ref=<taskId>`, alongside a home row under
// this prefix. The channel row is the deterministic task→channel join.
const UNFILED_PREFIX = "Unfiled/";

interface ChannelPlacement {
  folderId: string;
  folderPath: string;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

// Path segments are "/"-separated on the backend, so a name can't contain one.
function sanitizeSegment(name: string): string {
  const cleaned = name.replace(/\//g, " ").replace(/\s+/g, " ").trim();
  return cleaned || "Untitled canvas";
}

async function folderByPath(
  client: PostHogAPIClient,
  path: string,
): Promise<ChannelPlacement | undefined> {
  const folders = await client.listDesktopFsEntries<CanvasFsEntry>(
    `type=folder&path=${encodeURIComponent(path)}`,
  );
  const folder = folders[0];
  return folder ? { folderId: folder.id, folderPath: folder.path } : undefined;
}

// Resolve the channel this task was created in from its desktop-fs filing row
// (`type=task&ref=<taskId>`, written by the app at task creation). An id-based
// join — no name matching, so it survives channel renames and duplicate names.
async function channelPlacementForTask(
  client: PostHogAPIClient,
  taskId: string | undefined,
): Promise<ChannelPlacement | undefined> {
  if (!taskId) return undefined;
  const rows = await client.listDesktopFsEntries<CanvasFsEntry>(
    `type=task&ref=${encodeURIComponent(taskId)}`,
  );
  const filed = rows.find(
    (r) => r.path.includes("/") && !r.path.startsWith(UNFILED_PREFIX),
  );
  if (!filed) return undefined;
  return folderByPath(client, parentOf(filed.path));
}

// For the not-in-a-channel error: name the channels the agent could offer the
// user instead of leaving it to guess what a valid `parentPath` looks like.
async function channelPathsForError(client: PostHogAPIClient): Promise<string> {
  try {
    const folders = await client.listDesktopFsEntries<CanvasFsEntry>(
      "type=folder&depth=1",
    );
    const paths = folders.slice(0, 20).map((f) => `"${f.path}"`);
    return paths.length ? ` Existing channels: ${paths.join(", ")}.` : "";
  } catch {
    return "";
  }
}

// Create-if-missing for `canvas_checkout`: an agent working from a normal task
// (not the channel generate bar) can start a canvas in one call instead of
// chaining the raw desktop-fs create tool first. The canvas is placed in the
// task's own channel, resolved tool-side from the task id — the model never
// has to know (or correctly relay) the channel.
async function createCanvasEntry(
  ctx: { taskId?: string },
  name: string | undefined,
  parentPath: string | undefined,
): Promise<CanvasFsEntry> {
  if (!name?.trim()) {
    throw new Error(
      "pass `id` to edit an existing canvas, or `name` to create a new one.",
    );
  }
  const client = createClient();
  if (!client) {
    throw new Error("No PostHog credentials available in this session.");
  }
  // Resolve the destination to an EXISTING channel folder before creating —
  // the backend auto-creates missing parents, so an unresolved path would
  // silently mint a phantom top-level folder instead of failing.
  let placement: ChannelPlacement | undefined;
  const overridePath = parentPath?.trim().replace(/\/+$/, "");
  if (overridePath) {
    placement = await folderByPath(client, overridePath);
    if (!placement) {
      throw new Error(
        `no channel folder exists at "${overridePath}".${await channelPathsForError(client)} ` +
          "Pass one of these as `parentPath`, or omit it to use this task's own channel.",
      );
    }
  } else {
    placement = await channelPlacementForTask(client, ctx.taskId);
    if (!placement) {
      throw new Error(
        `this task isn't filed in a channel, so the canvas has nowhere to live.${await channelPathsForError(client)} ` +
          "Ask the user which channel to create it in, then pass that folder path as `parentPath`.",
      );
    }
  }
  const now = Date.now();
  return client.createDesktopCanvas<CanvasFsEntry>({
    path: `${placement.folderPath}/${sanitizeSegment(name)}`,
    // The same meta shape the app stamps on UI-created canvases, so the canvas
    // opens and lists identically to one made from the channel grid.
    meta: {
      channelId: placement.folderId,
      templateId: FREEFORM_TEMPLATE_ID,
      createdAt: now,
      updatedAt: now,
    },
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
    "an existing canvas, or omit `id` and pass `name` to create a fresh one — it is placed in this " +
    "task's own channel automatically. Fetches (or creates) the canvas, writes its source to a local " +
    "scratch file, records the base version for the publish-time concurrency guard, and returns the " +
    "scratch path plus the authoring contract to follow. Edit that file with your normal file-editing " +
    "tools, then call canvas_publish. Always start canvas work with this tool.",
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
        "Name for a NEW canvas when `id` is omitted — creates it in this task's channel, then checks it out.",
      ),
    parentPath: z
      .string()
      .optional()
      .describe(
        "Override the destination channel when creating: the exact folder path of an EXISTING channel. " +
          "Normally omit it — the new canvas lands in this task's own channel automatically. Only pass it " +
          "when the user explicitly names a different channel (or this task isn't in one).",
      ),
  },
  alwaysLoad: true,
  autoApprove: true,
  isEnabled: () => resolveSandboxPosthogApi() !== undefined,
  handler: async (ctx, args): Promise<LocalToolResult> => {
    try {
      const entry = args.id
        ? await fetchCanvasEntry(args.id)
        : await createCanvasEntry(ctx, args.name, args.parentPath);
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
