import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { APP_META_SERVICE, type IAppMeta } from "@posthog/platform/app-meta";
import {
  DIALOG_SERVICE,
  type DialogSeverity,
  type IDialog,
} from "@posthog/platform/dialog";
import {
  type IImageProcessor,
  IMAGE_PROCESSOR_SERVICE,
} from "@posthog/platform/image-processor";
import {
  type IUrlLauncher,
  URL_LAUNCHER_SERVICE,
} from "@posthog/platform/url-launcher";
import {
  type IWorkspaceSettings,
  WORKSPACE_SETTINGS_SERVICE,
} from "@posthog/platform/workspace-settings";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  IMAGE_MIME_TYPES,
  isRasterImageFile,
} from "@posthog/shared";
import { inject, injectable } from "inversify";
import type {
  ClaudePermissions,
  ImageAttachment,
  MessageBoxOptions,
  SavedAttachment,
  SelectAttachmentsMode,
  SelectedAttachment,
} from "./schemas";

const fsPromises = fs.promises;

const MAX_IMAGE_DIMENSION = 1568;
const JPEG_QUALITY = 85;
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const CLIPBOARD_TEMP_DIR = path.join(os.tmpdir(), "posthog-code-clipboard");
const claudeSettingsPath = path.join(os.homedir(), ".claude", "settings.json");

@injectable()
export class OsService {
  constructor(
    @inject(DIALOG_SERVICE)
    private readonly dialog: IDialog,
    @inject(URL_LAUNCHER_SERVICE)
    private readonly urlLauncher: IUrlLauncher,
    @inject(APP_META_SERVICE)
    private readonly appMeta: IAppMeta,
    @inject(IMAGE_PROCESSOR_SERVICE)
    private readonly imageProcessor: IImageProcessor,
    @inject(WORKSPACE_SETTINGS_SERVICE)
    private readonly workspaceSettings: IWorkspaceSettings,
  ) {}

  async getClaudePermissions(): Promise<ClaudePermissions> {
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
  }

  async selectDirectory(): Promise<string | null> {
    const paths = await this.dialog.pickFile({
      title: "Select a repository folder",
      directories: true,
      createDirectories: true,
    });
    return paths[0] ?? null;
  }

  async selectFiles(): Promise<string[]> {
    return this.dialog.pickFile({
      title: "Select files",
      multiple: true,
    });
  }

  async selectAttachments(
    mode: SelectAttachmentsMode,
  ): Promise<SelectedAttachment[]> {
    const titleByMode = {
      files: "Select files",
      directories: "Select folders",
      both: "Select files or folders",
    } as const;
    const paths = await this.dialog.pickFile({
      title: titleByMode[mode],
      multiple: true,
      directories: mode === "directories",
      filesAndDirectories: mode === "both",
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
    return statResults.filter((r): r is SelectedAttachment => r !== null);
  }

  async checkWriteAccess(directoryPath: string): Promise<boolean> {
    if (!directoryPath) return false;
    try {
      await fsPromises.access(directoryPath, fs.constants.W_OK);
      const testFile = path.join(
        directoryPath,
        `.agent-write-test-${Date.now()}`,
      );
      await fsPromises.writeFile(testFile, "ok");
      await fsPromises.unlink(testFile).catch(() => {});
      return true;
    } catch {
      return false;
    }
  }

  async showMessageBox(
    options: MessageBoxOptions,
  ): Promise<{ response: number }> {
    const severity: DialogSeverity | undefined =
      options?.type && options.type !== "none" ? options.type : undefined;
    const response = await this.dialog.confirm({
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
  }

  async openExternal(url: string): Promise<void> {
    await this.urlLauncher.launch(url);
  }

  async searchDirectories(query: string): Promise<string[]> {
    if (!query?.trim()) return [];

    const searchPath = this.expandHomePath(query.trim());
    const lastSlashIdx = searchPath.lastIndexOf("/");
    const basePath =
      lastSlashIdx === -1 ? "" : searchPath.substring(0, lastSlashIdx + 1);
    const searchTerm =
      lastSlashIdx === -1 ? searchPath : searchPath.substring(lastSlashIdx + 1);
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
  }

  getAppVersion(): string {
    return this.appMeta.version;
  }

  getWorktreeLocation(): string {
    return this.workspaceSettings.getWorktreeLocation();
  }

  async readFileAsDataUrl(
    filePath: string,
    maxSizeBytes: number,
  ): Promise<string | null> {
    try {
      const stat = await fsPromises.stat(filePath);
      if (stat.size > maxSizeBytes) return null;

      const ext = path.extname(filePath).toLowerCase().slice(1);
      const mime = IMAGE_MIME_TYPES[ext];
      if (!mime || !ALLOWED_IMAGE_MIME_TYPES.has(mime)) return null;

      const buffer = await fsPromises.readFile(filePath);
      return `data:${mime};base64,${buffer.toString("base64")}`;
    } catch {
      return null;
    }
  }

  async saveClipboardText(
    text: string,
    originalName?: string,
  ): Promise<SavedAttachment> {
    const displayName = path.basename(originalName ?? "pasted-text.txt");
    const filePath = await this.createClipboardTempFilePath(displayName);
    await fsPromises.writeFile(filePath, text, "utf-8");
    return { path: filePath, name: displayName };
  }

  async saveClipboardImage(
    base64Data: string,
    mimeType: string,
    originalName?: string,
  ): Promise<ImageAttachment> {
    const raw = new Uint8Array(Buffer.from(base64Data, "base64"));
    const isGenericName =
      !originalName ||
      originalName === "image.png" ||
      originalName === "image.jpeg" ||
      originalName === "image.jpg";
    const displayName = isGenericName
      ? "clipboard.png"
      : (originalName ?? "clipboard.png");

    return this.downscaleAndPersist(raw, mimeType, displayName);
  }

  async downscaleImageFile(filePath: string): Promise<ImageAttachment> {
    const ext = path.extname(filePath).toLowerCase().slice(1);
    if (!isRasterImageFile(filePath)) {
      throw new Error(`Unsupported image type: .${ext}`);
    }

    const stat = await fsPromises.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `Image too large (${Math.round(stat.size / 1024 / 1024)}MB). Max is 50MB.`,
      );
    }

    const raw = new Uint8Array(await fsPromises.readFile(filePath));
    const inputMime = IMAGE_MIME_TYPES[ext];

    return this.downscaleAndPersist(raw, inputMime, path.basename(filePath));
  }

  async saveClipboardFile(
    base64Data: string,
    originalName?: string,
  ): Promise<SavedAttachment> {
    const displayName = path.basename(originalName ?? "attachment");
    const filePath = await this.createClipboardTempFilePath(displayName);
    await fsPromises.writeFile(filePath, Buffer.from(base64Data, "base64"));
    return { path: filePath, name: displayName };
  }

  private async createClipboardTempFilePath(
    displayName: string,
  ): Promise<string> {
    const safeName = path.basename(displayName) || "attachment";
    await fsPromises.mkdir(CLIPBOARD_TEMP_DIR, { recursive: true });
    const tempDir = await fsPromises.mkdtemp(
      path.join(CLIPBOARD_TEMP_DIR, "attachment-"),
    );
    return path.join(tempDir, safeName);
  }

  private async downscaleAndPersist(
    raw: Uint8Array,
    inputMime: string,
    displayName: string,
  ): Promise<ImageAttachment> {
    const { buffer, mimeType, extension } = this.imageProcessor.downscale(
      raw,
      inputMime,
      { maxDimension: MAX_IMAGE_DIMENSION, jpegQuality: JPEG_QUALITY },
    );

    const finalName = displayName.replace(/\.[^.]+$/, `.${extension}`);
    const filePath = await this.createClipboardTempFilePath(finalName);
    await fsPromises.writeFile(filePath, Buffer.from(buffer));

    return { path: filePath, name: finalName, mimeType };
  }

  private expandHomePath(searchPath: string): string {
    return searchPath.startsWith("~")
      ? searchPath.replace(/^~/, os.homedir())
      : searchPath;
  }
}
