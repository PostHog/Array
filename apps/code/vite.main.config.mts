import { execFile, execSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { unzipSync } from "fflate";
import { defineConfig, loadEnv, type Plugin } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import {
  createForceDevModeDefine,
  createPosthogPlugin,
  mainAliases,
} from "./vite.shared.mjs";
import { autoServicesPlugin } from "./vite-plugin-auto-services";

function getGitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function getBuildDate(): string {
  return new Date().toISOString();
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixFilenameCircularRef(): Plugin {
  return {
    name: "fix-filename-circular-ref",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const fileName in bundle) {
        const chunk = bundle[fileName];
        if (chunk.type === "chunk") {
          chunk.code = chunk.code.replace(
            /const __filename(\d+) = [\w$]+\.fileURLToPath\(typeof document === "undefined" \? require\("url"\)\.pathToFileURL\(__filename\1\)\.href : [^;]+\);/g,
            "const __filename$1 = __filename;",
          );
        }
      }
    },
  };
}

let claudeCliCopied = false;

function copyClaudeExecutable(): Plugin {
  return {
    name: "copy-claude-executable",
    writeBundle() {
      const destDir = join(__dirname, ".vite/build/claude-cli");

      // Skip re-copying on subsequent HMR rebuilds
      if (claudeCliCopied && existsSync(join(destDir, "cli.js"))) {
        return;
      }

      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      const candidates = [
        {
          path: join(__dirname, "node_modules/@posthog/agent/dist/claude-cli"),
          type: "package",
        },
        {
          path: join(
            __dirname,
            "../../node_modules/@posthog/agent/dist/claude-cli",
          ),
          type: "package",
        },
        {
          path: join(__dirname, "../../packages/agent/dist/claude-cli"),
          type: "package",
        },
      ];

      for (const candidate of candidates) {
        if (
          existsSync(join(candidate.path, "cli.js")) &&
          existsSync(join(candidate.path, "yoga.wasm"))
        ) {
          const files = ["cli.js", "package.json", "yoga.wasm"];
          for (const file of files) {
            copyFileSync(join(candidate.path, file), join(destDir, file));
          }
          const vendorDir = join(candidate.path, "vendor");
          if (existsSync(vendorDir)) {
            cpSync(vendorDir, join(destDir, "vendor"), { recursive: true });
          }
          claudeCliCopied = true;
          return;
        }
      }

      const rootNodeModules = join(__dirname, "../../node_modules");
      const sdkDir = join(rootNodeModules, "@anthropic-ai/claude-agent-sdk");
      const yogaDir = join(rootNodeModules, "yoga-wasm-web/dist");

      if (
        existsSync(join(sdkDir, "cli.js")) &&
        existsSync(join(yogaDir, "yoga.wasm"))
      ) {
        copyFileSync(join(sdkDir, "cli.js"), join(destDir, "cli.js"));
        copyFileSync(
          join(sdkDir, "package.json"),
          join(destDir, "package.json"),
        );
        copyFileSync(join(yogaDir, "yoga.wasm"), join(destDir, "yoga.wasm"));
        const vendorDir = join(sdkDir, "vendor");
        if (existsSync(vendorDir)) {
          cpSync(vendorDir, join(destDir, "vendor"), { recursive: true });
        }
        console.log(
          "Assembled Claude CLI from workspace sources in claude-cli/ subdirectory",
        );
        claudeCliCopied = true;
        return;
      }

      console.warn(
        "[copy-claude-executable] FAILED to find Claude CLI artifacts. Agent execution may fail.",
      );
      console.warn("Checked paths:", candidates.map((c) => c.path).join(", "));
      console.warn("Checked workspace sources:", sdkDir);
    },
  };
}

function getFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...getFilesRecursive(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

const SKILLS_ZIP_URL =
  "https://github.com/PostHog/posthog/releases/download/agent-skills-latest/skills.zip";

const CONTEXT_MILL_ZIP_URL =
  "https://github.com/PostHog/context-mill/releases/latest/download/skills-mcp-resources.zip";

const execFileAsync = promisify(execFile);

/**
 * Downloads skills.zip from GitHub releases and extracts into targetDir.
 * Returns true on success, false on failure (non-fatal).
 */
async function downloadAndExtractSkills(targetDir: string): Promise<boolean> {
  try {
    const tempDir = join(tmpdir(), `posthog-code-vite-skills-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      const zipPath = join(tempDir, "skills.zip");

      // Download using curl (available on macOS/Linux, works in Node without extra deps)
      await execFileAsync("curl", ["-fsSL", "-o", zipPath, SKILLS_ZIP_URL], {
        timeout: 30_000,
      });

      // Extract
      const extractDir = join(tempDir, "extracted");
      await mkdir(extractDir, { recursive: true });
      const zipData = readFileSync(zipPath);
      const unzipped = unzipSync(new Uint8Array(zipData));
      for (const [filename, content] of Object.entries(unzipped)) {
        const fullPath = join(extractDir, filename);
        if (filename.endsWith("/")) {
          await mkdir(fullPath, { recursive: true });
        } else {
          await mkdir(dirname(fullPath), { recursive: true });
          await writeFile(fullPath, content);
        }
      }

      // Find skills directory in extracted content
      const skillsSource = await findSkillsDirInExtract(extractDir);
      if (!skillsSource) {
        console.warn(
          "[copy-posthog-plugin] No skills directory found in downloaded archive",
        );
        return false;
      }

      // Overlay skill directories into target
      await mkdir(targetDir, { recursive: true });
      const entries = await readdir(skillsSource, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dest = join(targetDir, entry.name);
          await rm(dest, { recursive: true, force: true });
          await cp(join(skillsSource, entry.name), dest, { recursive: true });
        }
      }

      console.log("[copy-posthog-plugin] Remote skills downloaded and merged");
      return true;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(
      "[copy-posthog-plugin] Failed to download remote skills (non-fatal):",
      err,
    );
    return false;
  }
}

/**
 * Finds the skills directory inside an extracted zip.
 * Handles: skills/ at root, nested (e.g. posthog/skills/), or skill dirs directly at root.
 */
async function findSkillsDirInExtract(
  extractDir: string,
): Promise<string | null> {
  const direct = join(extractDir, "skills");
  if (existsSync(direct)) return direct;

  const entries = await readdir(extractDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = join(extractDir, entry.name, "skills");
      if (existsSync(nested)) return nested;
    }
  }

  // Check if extracted dir itself contains skill directories (dirs with SKILL.md)
  const hasSkillDirs = entries.some(
    (e) => e.isDirectory() && existsSync(join(extractDir, e.name, "SKILL.md")),
  );
  if (hasSkillDirs) return extractDir;

  return null;
}

/**
 * Downloads context-mill skills-mcp-resources.zip (a zip-of-zips), extracts
 * omnibus-* inner zips, strips the "omnibus-" prefix, and writes into targetDir.
 * Returns true on success, false on failure (non-fatal).
 */
async function downloadAndExtractContextMillSkills(
  targetDir: string,
): Promise<boolean> {
  try {
    const tempDir = join(tmpdir(), `posthog-code-vite-cm-skills-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });

    try {
      const zipPath = join(tempDir, "context-mill.zip");

      await execFileAsync(
        "curl",
        ["-fsSL", "-o", zipPath, CONTEXT_MILL_ZIP_URL],
        { timeout: 30_000 },
      );

      const zipData = readFileSync(zipPath);
      const outerEntries = unzipSync(new Uint8Array(zipData));

      await mkdir(targetDir, { recursive: true });

      for (const [filename, content] of Object.entries(outerEntries)) {
        const base = filename.replace(/^.*\//, ""); // strip any directory prefix
        if (!base.startsWith("omnibus-") || !base.endsWith(".zip")) continue;

        const strippedName = base
          .replace(/^omnibus-/, "")
          .replace(/\.zip$/, "");
        const innerEntries = unzipSync(new Uint8Array(content));
        const destDir = join(targetDir, strippedName);
        await mkdir(destDir, { recursive: true });

        for (const [innerFile, innerContent] of Object.entries(innerEntries)) {
          if (innerFile.endsWith("/")) {
            await mkdir(join(destDir, innerFile), { recursive: true });
          } else {
            await mkdir(dirname(join(destDir, innerFile)), { recursive: true });
            let data = innerContent;
            if (innerFile === "SKILL.md" || innerFile.endsWith("/SKILL.md")) {
              const text = new TextDecoder().decode(innerContent);
              const patched = text.replace(/^(name:\s*)omnibus-/m, "$1");
              data = new TextEncoder().encode(patched);
            }
            await writeFile(join(destDir, innerFile), data);
          }
        }
      }

      console.log(
        "[copy-posthog-plugin] Context-mill omnibus skills downloaded and merged",
      );
      return true;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(
      "[copy-posthog-plugin] Failed to download context-mill skills (non-fatal):",
      err,
    );
    return false;
  }
}

const PLUGIN_ALLOW_LIST = [
  "plugin.json",
  ".mcp.json",
  ".lsp.json",
  "commands",
  "agents",
  "skills",
  "hooks",
];

let remoteSkillsFetched = false;

function copyPosthogPlugin(isDev: boolean): Plugin {
  const sourceDir = join(__dirname, "../../plugins/posthog");
  const localSkillsDir = join(sourceDir, "local-skills");

  return {
    name: "copy-posthog-plugin",
    buildStart() {
      if (existsSync(sourceDir)) {
        for (const file of getFilesRecursive(sourceDir)) {
          // Don't watch local-skills in production builds
          if (!isDev && file.startsWith(localSkillsDir)) continue;
          this.addWatchFile(file);
        }
      }

      // Watch local-skills dir in dev mode
      if (isDev && existsSync(localSkillsDir)) {
        for (const file of getFilesRecursive(localSkillsDir)) {
          this.addWatchFile(file);
        }
      }
    },
    async writeBundle() {
      const destDir = join(__dirname, ".vite/build/plugins/posthog");
      const destSkillsDir = join(destDir, "skills");

      // 1. Copy allowed plugin entries
      await mkdir(destDir, { recursive: true });
      for (const entry of PLUGIN_ALLOW_LIST) {
        const src = join(sourceDir, entry);
        if (!existsSync(src)) continue;
        const dest = join(destDir, entry);
        if (statSync(src).isDirectory()) {
          await cp(src, dest, { recursive: true });
        } else {
          await cp(src, dest);
        }
      }

      // 2. Download and overlay remote skills (overrides same-named shipped skills)
      // Skip re-downloading on subsequent HMR rebuilds
      if (!remoteSkillsFetched) {
        await downloadAndExtractSkills(destSkillsDir);

        // 2b. Download and overlay context-mill omnibus skills (overrides same-named skills)
        await downloadAndExtractContextMillSkills(destSkillsDir);
        remoteSkillsFetched = true;
      }

      // 3. In dev mode: overlay local-skills (overrides both shipped and remote)
      if (isDev && existsSync(localSkillsDir)) {
        const entries = await readdir(localSkillsDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const dest = join(destSkillsDir, entry.name);
            await rm(dest, { recursive: true, force: true });
            await cp(join(localSkillsDir, entry.name), dest, {
              recursive: true,
            });
          }
        }
        console.log("[copy-posthog-plugin] Local dev skills overlaid");
      }
    },
  };
}

function copyDrizzleMigrations(): Plugin {
  const migrationsDir = join(__dirname, "src/main/db/migrations");
  return {
    name: "copy-drizzle-migrations",
    buildStart() {
      if (existsSync(migrationsDir)) {
        for (const file of getFilesRecursive(migrationsDir)) {
          this.addWatchFile(file);
        }
      }
    },
    writeBundle() {
      const destDir = join(__dirname, ".vite/build/db-migrations");
      if (existsSync(migrationsDir)) {
        cpSync(migrationsDir, destDir, { recursive: true });
      }
    },
  };
}

let enricherGrammarsCopied = false;

function copyEnricherGrammars(): Plugin {
  return {
    name: "copy-enricher-grammars",
    writeBundle() {
      // `.vite/grammars` is what the bundle resolves at dev-time; electron-forge
      // only copies `.vite/build/**` into the packaged app, so we need both.
      const destDirs = [
        join(__dirname, ".vite/grammars"),
        join(__dirname, ".vite/build/grammars"),
      ];

      if (enricherGrammarsCopied && destDirs.every((d) => existsSync(d))) {
        return;
      }

      const candidates = [
        join(__dirname, "node_modules/@posthog/enricher/grammars"),
        join(__dirname, "../../node_modules/@posthog/enricher/grammars"),
        join(__dirname, "../../packages/enricher/grammars"),
      ];

      const sourceDir = candidates.find((p) => existsSync(p));
      if (!sourceDir) {
        console.warn(
          "[copy-enricher-grammars] grammars directory not found. Checked:",
          candidates.join(", "),
        );
        return;
      }

      for (const destDir of destDirs) {
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        cpSync(sourceDir, destDir, { recursive: true });
      }
      enricherGrammarsCopied = true;
      console.log(
        `Copied enricher grammars from ${sourceDir} to ${destDirs.join(", ")}`,
      );
    },
  };
}

let codexAcpCopied = false;

function copyCodexAcpBinaries(): Plugin {
  return {
    name: "copy-codex-acp-binaries",
    writeBundle() {
      const destDir = join(__dirname, ".vite/build/codex-acp");

      // Skip re-copying on subsequent HMR rebuilds
      if (codexAcpCopied && existsSync(destDir)) {
        return;
      }

      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true });
      }

      const sourceDir = join(__dirname, "resources/codex-acp");
      const binaries = [
        { name: "codex-acp", winName: "codex-acp.exe" },
        { name: "rg", winName: "rg.exe" },
      ];

      for (const binary of binaries) {
        const binaryName =
          process.platform === "win32" ? binary.winName : binary.name;
        const sourcePath = join(sourceDir, binaryName);

        if (existsSync(sourcePath)) {
          const destPath = join(destDir, binaryName);
          copyFileSync(sourcePath, destPath);
          console.log(`Copied ${binary.name} binary to ${destDir}`);

          if (process.platform === "darwin") {
            try {
              execSync(`xattr -cr "${destPath}"`, { stdio: "inherit" });
              execSync(`codesign --force --sign - "${destPath}"`, {
                stdio: "inherit",
              });
              console.log(`Ad-hoc signed ${binary.name} binary`);
            } catch (err) {
              console.warn(`Failed to sign ${binary.name} binary:`, err);
            }
          }
        } else {
          console.warn(
            `[copy-codex-acp-binaries] ${binary.name} not found at ${sourcePath}. Run 'node scripts/download-binaries.mjs' first.`,
          );
        }
      }
      codexAcpCopied = true;
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, "../.."), "");
  const isDev = mode === "development";

  return {
    plugins: [
      tsconfigPaths(),
      autoServicesPlugin(join(__dirname, "src/main/services")),
      fixFilenameCircularRef(),
      copyClaudeExecutable(),
      copyPosthogPlugin(isDev),
      copyDrizzleMigrations(),
      copyCodexAcpBinaries(),
      copyEnricherGrammars(),
      createPosthogPlugin(env, "posthog-code-main"),
    ].filter(Boolean),
    define: {
      __BUILD_COMMIT__: JSON.stringify(getGitCommit()),
      __BUILD_DATE__: JSON.stringify(getBuildDate()),
      "process.env.VITE_POSTHOG_API_KEY": JSON.stringify(
        env.VITE_POSTHOG_API_KEY || "",
      ),
      "process.env.VITE_POSTHOG_API_HOST": JSON.stringify(
        env.VITE_POSTHOG_API_HOST || "",
      ),
      "process.env.VITE_POSTHOG_ACCESS_TOKEN_OVERRIDE": JSON.stringify(
        env.VITE_POSTHOG_ACCESS_TOKEN_OVERRIDE || "",
      ),
      "process.env.SKILLS_ZIP_URL": JSON.stringify(SKILLS_ZIP_URL),
      "process.env.CONTEXT_MILL_ZIP_URL": JSON.stringify(CONTEXT_MILL_ZIP_URL),
      ...createForceDevModeDefine(),
    },
    resolve: {
      alias: mainAliases,
    },
    cacheDir: ".vite/cache",
    build: {
      target: "node18",
      sourcemap: true,
      minify: false,
      reportCompressedSize: false,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
      rollupOptions: {
        external: [
          "node-pty",
          "@parcel/watcher",
          "file-icon",
          "better-sqlite3",
        ],
        onwarn(warning, warn) {
          if (warning.code === "UNUSED_EXTERNAL_IMPORT") return;
          warn(warning);
        },
      },
    },
  };
});
