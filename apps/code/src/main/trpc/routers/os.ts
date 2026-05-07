import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IAppMeta } from "@posthog/platform/app-meta";
import type { DialogSeverity, IDialog } from "@posthog/platform/dialog";
import type { IImageProcessor } from "@posthog/platform/image-processor";
import type { IUrlLauncher } from "@posthog/platform/url-launcher";
import { IMAGE_MIME_TYPES } from "@shared/constants/image";
import { z } from "zod";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import { getWorktreeLocation } from "../../services/settingsStore";
import { publicProcedure, router } from "../trpc";

const fsPromises = fs.promises;

const getUrlLauncher = () =>
  container.get<IUrlLauncher>(MAIN_TOKENS.UrlLauncher);
const getDialog = () => container.get<IDialog>(MAIN_TOKENS.Dialog);
const getAppMeta = () => container.get<IAppMeta>(MAIN_TOKENS.AppMeta);
const getImageProcessor = () =>
  container.get<IImageProcessor>(MAIN_TOKENS.ImageProcessor);

const messageBoxOptionsSchema = z.object({
  type: z.enum(["none", "info", "error", "question", "warning"]).optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  detail: z.string().optional(),
  buttons: z.array(z.string()).optional(),
  defaultId: z.number().optional(),
  cancelId: z.number().optional(),
});

const expandHomePath = (searchPath: string): string =>
  searchPath.startsWith("~")
    ? searchPath.replace(/^~/, os.homedir())
    : searchPath;

const MAX_IMAGE_DIMENSION = 1568;
const JPEG_QUALITY = 85;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const CLIPBOARD_TEMP_DIR = path.join(os.tmpdir(), "posthog-code-clipboard");

async function createClipboardTempFilePath(
  displayName: string,
): Promise<string> {
  const safeName = path.basename(displayName) || "attachment";
  await fsPromises.mkdir(CLIPBOARD_TEMP_DIR, { recursive: true });
  const tempDir = await fsPromises.mkdtemp(
    path.join(CLIPBOARD_TEMP_DIR, "attachment-"),
  );
  return path.join(tempDir, safeName);
}

async function downscaleAndPersist(
  raw: Uint8Array,
  inputMime: string,
  displayName: string,
): Promise<{ path: string; name: string; mimeType: string }> {
  const { buffer, mimeType, extension } = getImageProcessor().downscale(
    raw,
    inputMime,
    { maxDimension: MAX_IMAGE_DIMENSION, jpegQuality: JPEG_QUALITY },
  );

  const finalName = displayName.replace(/\.[^.]+$/, `.${extension}`);
  const filePath = await createClipboardTempFilePath(finalName);
  await fsPromises.writeFile(filePath, Buffer.from(buffer));

  return { path: filePath, name: finalName, mimeType };
}

const claudeSettingsPath = path.join(os.homedir(), ".claude", "settings.json");

export const osRouter = router({
  getClaudePermissions: publicProcedure
    .output(
      z.object({
        allow: z.array(z.string()),
        deny: z.array(z.string()),
      }),
    )
    .query(async () => {
      try {
        const content = await fsPromises.readFile(claudeSettingsPath, "utf-8");
        const settings = JSON.parse(content);
        return {
          allow: Array.isArray(settings?.permissions?.allow)
            ? settings.permissions.allow
            : [],
          deny: Array.isArray(settings?.permissions?.deny)
            ? settings.permissions.deny
            : [],
        };
      } catch {
        return { allow: [], deny: [] };
      }
    }),

  /**
   * Show directory picker dialog
   */
  selectDirectory: publicProcedure.query(async () => {
    const paths = await getDialog().pickFile({
      title: "Select a repository folder",
      directories: true,
      createDirectories: true,
    });
    return paths[0] ?? null;
  }),

  /**
   * Show file picker dialog
   */
  selectFiles: publicProcedure.output(z.array(z.string())).query(async () => {
    return await getDialog().pickFile({
      title: "Select files",
      multiple: true,
    });
  }),

  /**
   * Show an attachment picker that can return files, directories, or both.
   * Stats each returned path so the renderer knows which is which.
   */
  selectAttachments: publicProcedure
    .input(
      z.object({
        mode: z.enum(["files", "directories", "both"]).default("both"),
      }),
    )
    .output(
      z.array(
        z.object({
          path: z.string(),
          kind: z.enum(["file", "directory"]),
        }),
      ),
    )
    .query(async ({ input }) => {
      const dialog = getDialog();
      const titleByMode = {
        files: "Select files",
        directories: "Select folders",
        both: "Select files or folders",
      } as const;
      const paths = await dialog.pickFile({
        title: titleByMode[input.mode],
        multiple: true,
        directories: input.mode === "directories",
        filesAndDirectories: input.mode === "both",
      });
      const statResults = await Promise.all(
        paths.map(async (p) => {
          try {
            const stat = await fsPromises.stat(p);
            return {
              path: p,
              kind: stat.isDirectory()
                ? ("directory" as const)
                : ("file" as const),
            };
          } catch {
            return null;
          }
        }),
      );
      return statResults.filter(
        (r): r is { path: string; kind: "file" | "directory" } => r !== null,
      );
    }),

  /**
   * Check if a directory has write access
   */
  checkWriteAccess: publicProcedure
    .input(z.object({ directoryPath: z.string() }))
    .query(async ({ input }) => {
      if (!input.directoryPath) return false;
      try {
        await fsPromises.access(input.directoryPath, fs.constants.W_OK);
        const testFile = path.join(
          input.directoryPath,
          `.agent-write-test-${Date.now()}`,
        );
        await fsPromises.writeFile(testFile, "ok");
        await fsPromises.unlink(testFile).catch(() => {});
        return true;
      } catch {
        return false;
      }
    }),

  /**
   * Show a message box dialog
   */
  showMessageBox: publicProcedure
    .input(z.object({ options: messageBoxOptionsSchema }))
    .mutation(async ({ input }) => {
      const options = input.options;
      const severity: DialogSeverity | undefined =
        options?.type && options.type !== "none" ? options.type : undefined;
      const response = await getDialog().confirm({
        severity,
        title: options?.title || "PostHog Code",
        message: options?.message || "",
        detail: options?.detail,
        options:
          Array.isArray(options?.buttons) && options.buttons.length > 0
            ? options.buttons
            : ["OK"],
        defaultIndex: options?.defaultId ?? 0,
        cancelIndex: options?.cancelId ?? 1,
      });
      return { response };
    }),

  /**
   * Open URL in external browser
   */
  openExternal: publicProcedure
    .input(z.object({ url: z.string() }))
    .mutation(async ({ input }) => {
      await getUrlLauncher().launch(input.url);
    }),

  /**
   * Search for directories matching a query
   */
  searchDirectories: publicProcedure
    .input(z.object({ query: z.string(), searchRoot: z.string().optional() }))
    .query(async ({ input }) => {
      if (!input.query?.trim()) return [];

      const searchPath = expandHomePath(input.query.trim());
      const lastSlashIdx = searchPath.lastIndexOf("/");
      const basePath =
        lastSlashIdx === -1 ? "" : searchPath.substring(0, lastSlashIdx + 1);
      const searchTerm =
        lastSlashIdx === -1
          ? searchPath
          : searchPath.substring(lastSlashIdx + 1);
      const pathToRead = basePath || os.homedir();

      try {
        const entries = await fsPromises.readdir(pathToRead, {
          withFileTypes: true,
        });
        const directories = entries.filter((entry) => entry.isDirectory());

        const filtered = searchTerm
          ? directories.filter((dir) =>
              dir.name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
          : directories;

        return filtered
          .map((dir) => path.join(pathToRead, dir.name))
          .sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
          .slice(0, 20);
      } catch {
        return [];
      }
    }),

  /**
   * Get the application version
   */
  getAppVersion: publicProcedure.query(() => getAppMeta().version),

  /**
   * Get the worktree base location (e.g., ~/.posthog-code)
   */
  getWorktreeLocation: publicProcedure.query(() => getWorktreeLocation()),

  /**
   * Read a file and return it as a base64 data URL
   * Used for image thumbnails in the editor
   */
  readFileAsDataUrl: publicProcedure
    .input(
      z.object({
        filePath: z.string(),
        maxSizeBytes: z
          .number()
          .optional()
          .default(10 * 1024 * 1024),
      }),
    )
    .query(async ({ input }) => {
      try {
        const stat = await fsPromises.stat(input.filePath);
        if (stat.size > input.maxSizeBytes) return null;

        const ext = path.extname(input.filePath).toLowerCase().slice(1);
        const mime = IMAGE_MIME_TYPES[ext] ?? "application/octet-stream";

        const buffer = await fsPromises.readFile(input.filePath);
        return `data:${mime};base64,${buffer.toString("base64")}`;
      } catch {
        return null;
      }
    }),

  /**
   * Save pasted text to a temp file
   * Returns the file path for use as a file attachment
   */
  saveClipboardText: publicProcedure
    .input(
      z.object({
        text: z.string(),
        originalName: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const displayName = path.basename(
        input.originalName ?? "pasted-text.txt",
      );
      const filePath = await createClipboardTempFilePath(displayName);

      await fsPromises.writeFile(filePath, input.text, "utf-8");

      return { path: filePath, name: displayName };
    }),

  /**
   * Save clipboard image data to a temp file
   * Returns the file path for use as a file attachment
   */
  saveClipboardImage: publicProcedure
    .input(
      z.object({
        base64Data: z.string(),
        mimeType: z.string(),
        originalName: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const raw = new Uint8Array(Buffer.from(input.base64Data, "base64"));
      const isGenericName =
        !input.originalName ||
        input.originalName === "image.png" ||
        input.originalName === "image.jpeg" ||
        input.originalName === "image.jpg";
      const displayName = isGenericName
        ? "clipboard.png"
        : (input.originalName ?? "clipboard.png");

      return downscaleAndPersist(raw, input.mimeType, displayName);
    }),

  downscaleImageFile: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const ext = path.extname(input.filePath).toLowerCase().slice(1);
      if (!IMAGE_MIME_TYPES[ext]) {
        throw new Error(`Unsupported image type: .${ext}`);
      }

      const stat = await fsPromises.stat(input.filePath);
      if (stat.size > MAX_FILE_SIZE) {
        throw new Error(
          `Image too large (${Math.round(stat.size / 1024 / 1024)}MB). Max is 50MB.`,
        );
      }

      const raw = new Uint8Array(await fsPromises.readFile(input.filePath));
      const inputMime = IMAGE_MIME_TYPES[ext];

      return downscaleAndPersist(raw, inputMime, path.basename(input.filePath));
    }),

  /**
   * Save arbitrary file bytes to a temp file
   * Returns the file path for use as a file attachment
   */
  saveClipboardFile: publicProcedure
    .input(
      z.object({
        base64Data: z.string(),
        originalName: z.string().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const displayName = path.basename(input.originalName ?? "attachment");
      const filePath = await createClipboardTempFilePath(displayName);

      await fsPromises.writeFile(
        filePath,
        Buffer.from(input.base64Data, "base64"),
      );

      return { path: filePath, name: displayName };
    }),
});
