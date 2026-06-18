import { existsSync } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ROOT_LOGGER,
  type RootLogger,
  type ScopedLogger,
} from "@posthog/di/logger";
import {
  ANALYTICS_SERVICE,
  type IAnalytics,
} from "@posthog/platform/analytics";
import { APP_META_SERVICE, type IAppMeta } from "@posthog/platform/app-meta";
import {
  BUNDLED_RESOURCES_SERVICE,
  type IBundledResources,
} from "@posthog/platform/bundled-resources";
import {
  type IStoragePaths,
  STORAGE_PATHS_SERVICE,
} from "@posthog/platform/storage-paths";
import { TypedEventEmitter } from "@posthog/shared";
import { inject, injectable, postConstruct, preDestroy } from "inversify";
import { getUserSkillsDir } from "../skills/skill-discovery";
import { getCodexSkillsDir, mirrorUserSkillsToCodex } from "./codex-mirror";
import {
  overlayDownloadedSkills,
  syncCodexSkills,
  UpdateSkillsSaga,
} from "./update-skills-saga";

const SKILLS_ZIP_URL = process.env.SKILLS_ZIP_URL ?? "";
const CONTEXT_MILL_ZIP_URL = process.env.CONTEXT_MILL_ZIP_URL ?? "";
const UPDATE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const CODEX_SKILLS_DIR = getCodexSkillsDir();
const USER_SKILLS_DIR = getUserSkillsDir();

interface PosthogPluginEvents {
  skillsUpdated: true;
}

@injectable()
export class PosthogPluginService extends TypedEventEmitter<PosthogPluginEvents> {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private lastCheckAt = 0;
  private updating = false;
  private readonly log: ScopedLogger;

  constructor(
    @inject(STORAGE_PATHS_SERVICE)
    private readonly storagePaths: IStoragePaths,
    @inject(BUNDLED_RESOURCES_SERVICE)
    private readonly bundledResources: IBundledResources,
    @inject(ANALYTICS_SERVICE)
    private readonly analytics: IAnalytics,
    @inject(APP_META_SERVICE)
    private readonly appMeta: IAppMeta,
    @inject(ROOT_LOGGER)
    logger: RootLogger,
  ) {
    super();
    this.log = logger.scope("posthog-plugin");
  }

  /** Runtime plugin dir under userData */
  private get runtimePluginDir(): string {
    return join(this.storagePaths.appDataPath, "plugins", "posthog");
  }

  /** Runtime skills cache (downloaded zips extracted here) */
  private get runtimeSkillsDir(): string {
    return join(this.storagePaths.appDataPath, "skills");
  }

  /** Bundled plugin path inside the .vite build output */
  private get bundledPluginDir(): string {
    return this.bundledResources.resolve(".vite/build/plugins/posthog");
  }

  @postConstruct()
  init(): void {
    this.initialize().catch((err) => {
      this.log.error("Skills initialization failed", { error: err });
      this.analytics.captureException(err, {
        source: "posthog-plugin",
        operation: "initialize",
      });
    });
  }

  private async initialize(): Promise<void> {
    // On first run (or after app update), copy the entire bundled plugin to the runtime dir.
    // On subsequent starts the runtime dir already exists — just overlay any cached downloaded skills.
    if (!existsSync(join(this.runtimePluginDir, "plugin.json"))) {
      await this.copyBundledPlugin();
    }

    // Overlay any previously-downloaded skills on top of the runtime plugin
    await overlayDownloadedSkills(this.runtimeSkillsDir, this.runtimePluginDir);

    await syncCodexSkills(this.getPluginPath(), CODEX_SKILLS_DIR);
    await this.mirrorUserSkills();

    // Start periodic updates
    this.intervalId = setInterval(() => {
      this.updateSkills().catch((err) => {
        this.log.warn("Periodic skills update failed", { error: err });
      });
    }, UPDATE_INTERVAL_MS);

    // Kick off first download
    await this.updateSkills();
  }

  /**
   * Mirrors the user's skills out to Codex ("bring your skills, use them
   * anywhere"). Never fatal: a broken mirror must not affect the official
   * skills pipeline or the mutation that triggered it.
   */
  async mirrorUserSkills(): Promise<void> {
    try {
      await mirrorUserSkillsToCodex(USER_SKILLS_DIR, CODEX_SKILLS_DIR);
    } catch (err) {
      this.log.warn("Mirroring user skills to Codex failed", { error: err });
    }
  }

  /**
   * Returns the path to the plugin directory that should be used for agent sessions.
   *
   * - In dev mode: Vite already merged shipped + remote + local-dev skills, so use bundled path.
   * - In prod: use the runtime plugin dir (with downloaded updates).
   * - Fallback: bundled plugin path.
   */
  getPluginPath(): string {
    if (!this.appMeta.isProduction) {
      return this.bundledPluginDir;
    }

    if (existsSync(join(this.runtimePluginDir, "plugin.json"))) {
      return this.runtimePluginDir;
    }

    return this.bundledPluginDir;
  }

  async updateSkills(): Promise<void> {
    const now = Date.now();
    if (now - this.lastCheckAt < UPDATE_INTERVAL_MS) {
      return;
    }

    if (this.updating) {
      return;
    }

    this.updating = true;
    this.lastCheckAt = now;

    const tempDir = join(tmpdir(), `posthog-code-skills-${Date.now()}`);

    try {
      await mkdir(tempDir, { recursive: true });

      const saga = new UpdateSkillsSaga(this.log);
      const result = await saga.run({
        runtimeSkillsDir: this.runtimeSkillsDir,
        runtimePluginDir: this.runtimePluginDir,
        pluginPath: this.getPluginPath(),
        codexSkillsDir: CODEX_SKILLS_DIR,
        tempDir,
        skillsZipUrl: SKILLS_ZIP_URL,
        contextMillZipUrl: CONTEXT_MILL_ZIP_URL,
        downloadFile: (url, destPath) => this.downloadFile(url, destPath),
      });

      if (result.success) {
        await this.mirrorUserSkills();
        this.emit("skillsUpdated", true);
      } else {
        this.log.warn("Skills update failed", {
          error: result.error,
          failedStep: result.failedStep,
        });
        this.analytics.captureException(new Error(result.error), {
          source: "posthog-plugin",
          operation: "updateSkills",
          failedStep: result.failedStep,
        });
      }
    } catch (err) {
      this.log.warn("Failed to update skills, will retry next interval", {
        error: err,
      });
      this.analytics.captureException(err, {
        source: "posthog-plugin",
        operation: "updateSkills",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      this.updating = false;
    }
  }

  /**
   * Copies the entire bundled plugin directory to the runtime location.
   * Called once on first run or after an app update.
   */
  private async copyBundledPlugin(): Promise<void> {
    try {
      if (!existsSync(this.bundledPluginDir)) {
        this.log.warn("Bundled plugin dir not found", {
          path: this.bundledPluginDir,
        });
        return;
      }
      await rm(this.runtimePluginDir, { recursive: true, force: true });
      await cp(this.bundledPluginDir, this.runtimePluginDir, {
        recursive: true,
      });
    } catch (err) {
      this.log.warn("Failed to copy bundled plugin", { error: err });
      this.analytics.captureException(err, {
        source: "posthog-plugin",
        operation: "copyBundledPlugin",
      });
    }
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `Download failed: ${response.status} ${response.statusText}`,
      );
    }

    const buffer = await response.arrayBuffer();
    await writeFile(destPath, Buffer.from(buffer));
  }

  @preDestroy()
  cleanup(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
