import type { ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { PublisherGithub } from "@electron-forge/publisher-github";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerAppImage } from "@reforged/maker-appimage";

const appleCodesignIdentity = process.env.APPLE_CODESIGN_IDENTITY;
const appleTeamId = process.env.APPLE_TEAM_ID;
const appleId = process.env.APPLE_ID;
const appleIdPassword =
  process.env.APPLE_APP_SPECIFIC_PASSWORD ?? process.env.APPLE_ID_PASSWORD;
const appleApiKey = process.env.APPLE_API_KEY;
const appleApiKeyId = process.env.APPLE_API_KEY_ID;
const appleApiIssuer = process.env.APPLE_API_ISSUER;
const appleNotarizeKeychainProfile =
  process.env.APPLE_NOTARIZE_KEYCHAIN_PROFILE;
const appleNotarizeKeychain = process.env.APPLE_NOTARIZE_KEYCHAIN;
const shouldSignMacApp = Boolean(appleCodesignIdentity);
const skipNotarize = process.env.SKIP_NOTARIZE === "1";

type NotaryToolCredentials =
  | {
      appleId: string;
      appleIdPassword: string;
      teamId: string;
    }
  | {
      appleApiKey: string;
      appleApiKeyId: string;
      appleApiIssuer: string;
    }
  | {
      keychainProfile: string;
      keychain?: string;
    };

let notarizeCredentials: NotaryToolCredentials | undefined;

if (appleId && appleIdPassword && appleTeamId) {
  notarizeCredentials = {
    appleId: appleId,
    appleIdPassword: appleIdPassword,
    teamId: appleTeamId,
  };
} else if (appleApiKey && appleApiKeyId && appleApiIssuer) {
  notarizeCredentials = {
    appleApiKey,
    appleApiKeyId,
    appleApiIssuer,
  };
} else if (appleNotarizeKeychainProfile) {
  notarizeCredentials = {
    keychainProfile: appleNotarizeKeychainProfile,
    ...(appleNotarizeKeychain ? { keychain: appleNotarizeKeychain } : {}),
  };
}

const notarizeConfig =
  !skipNotarize && shouldSignMacApp && notarizeCredentials
    ? notarizeCredentials
    : undefined;

let electronChild: ChildProcess | null = null;

function killElectronChild() {
  if (electronChild && !electronChild.killed) {
    console.log("[forge] Killing Electron child process");
    electronChild.kill("SIGTERM");
    electronChild = null;
  }
}

process.on("SIGINT", killElectronChild);
process.on("SIGTERM", killElectronChild);
const osxSignConfig =
  shouldSignMacApp && appleCodesignIdentity
    ? ({
        identity: appleCodesignIdentity,
        optionsForFile: () => {
          // Entitlements for all binaries/frameworks
          return {
            hardenedRuntime: true,
            entitlements: "build/entitlements.mac.plist",
          };
        },
      } satisfies Record<string, unknown>)
    : undefined;

function copyNativeDependency(
  dependency: string,
  destinationRoot: string,
): void {
  const source = path.resolve("../../node_modules", dependency);
  if (!existsSync(source)) {
    // Fallback to local node_modules
    const localSource = path.resolve("node_modules", dependency);
    if (existsSync(localSource)) {
      copySync(dependency, destinationRoot, localSource);
      return;
    }

    console.warn(
      `[forge] Native dependency "${dependency}" not found, skipping copy`,
    );
    return;
  }

  const nodeModulesDir = path.join(destinationRoot, "node_modules");
  mkdirSync(nodeModulesDir, { recursive: true });

  const destination = path.join(nodeModulesDir, dependency);
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true, dereference: true });
  console.log(
    `[forge] Copied native dependency "${dependency}" into ${path.relative(
      process.cwd(),
      destination,
    )}`,
  );
}

function copySync(dependency: string, destinationRoot: string, source: string) {
  const nodeModulesDir = path.join(destinationRoot, "node_modules");
  mkdirSync(nodeModulesDir, { recursive: true });

  const destination = path.join(nodeModulesDir, dependency);
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true, dereference: true });
  console.log(
    `[forge] Copied native dependency "${dependency}" into ${path.relative(
      process.cwd(),
      destination,
    )}`,
  );
}

const hasAssetsCar = existsSync("build/Assets.car");

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack:
        "{**/*.node,**/spawn-helper,**/.vite/build/claude-cli/**,**/.vite/build/plugins/posthog/**,**/.vite/build/codex-acp/**,**/.vite/build/grammars/**,**/node_modules/node-pty/**,**/node_modules/@parcel/**,**/node_modules/file-icon/**,**/node_modules/better-sqlite3/**,**/node_modules/bindings/**,**/node_modules/file-uri-to-path/**}",
    },
    prune: false,
    name: "PostHog Code",
    executableName: "PostHog Code",
    icon: "./build/app-icon", // Forge adds .icns/.ico/.png based on platform
    appBundleId: "com.posthog.array",
    appCategoryType: "public.app-category.productivity",
    extraResource: hasAssetsCar
      ? ["build/Assets.car", "build/app-icon.png"]
      : ["build/app-icon.png"],
    extendInfo: hasAssetsCar
      ? {
          CFBundleIconName: "Icon",
        }
      : {},
    ...(osxSignConfig
      ? {
          osxSign: osxSignConfig,
        }
      : {}),
    ...(notarizeConfig
      ? {
          osxNotarize: notarizeConfig,
        }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({
      icon: "./build/app-icon.icns",
      format: "ULFO",
      background: "./build/dmg-background.png",
      iconSize: 80,
      window: { size: { width: 560, height: 380 } },
      contents: (opts) => [
        { x: 104, y: 55, type: "file", path: opts.appPath },
        { x: 104, y: 243, type: "link", path: "/Applications" },
      ],
      ...(shouldSignMacApp && appleCodesignIdentity
        ? {
            "code-sign": {
              "signing-identity": appleCodesignIdentity,
              identifier: "com.posthog.array",
            },
          }
        : {}),
    }),
    new MakerSquirrel({
      name: "PostHogCode",
      setupIcon: "./build/app-icon.ico",
    }),
    new MakerAppImage({
      options: {
        icon: "./build/app-icon.png",
        categories: ["Development"],
        bin: "PostHog Code",
      },
    }),
    new MakerZIP({}, ["darwin", "linux"]),
  ],
  hooks: {
    generateAssets: async () => {
      if (process.platform !== "darwin") return;

      if (
        existsSync("build/app-icon.png") &&
        !existsSync("build/app-icon.icns")
      ) {
        execSync("bash scripts/generate-icns.sh", { stdio: "inherit" });
      }

      if (existsSync("build/icon.icon") && !existsSync("build/Assets.car")) {
        execSync("bash scripts/compile-glass-icon.sh", { stdio: "inherit" });
      }
    },
    prePackage: async () => {
      if (process.platform !== "darwin") return;

      // Build native modules for DMG maker on Node.js 22. These run on the
      // build host (DMG creation is host-side), so we force npm to target the
      // host arch even when the rest of the build is cross-targeting (e.g.
      // building darwin-x64 on an arm64 runner).
      const modules = ["macos-alias", "fs-xattr"];
      const hostBuildEnv = {
        ...process.env,
        npm_config_arch: process.arch,
        npm_config_platform: process.platform,
      };

      for (const mod of modules) {
        const candidates = [
          path.join("node_modules", mod),
          path.resolve("../../node_modules", mod),
        ];
        const modulePath = candidates.find((p) => existsSync(p));

        if (modulePath) {
          console.log(`Building native module: ${mod} (${modulePath})`);
          execSync("npm install", {
            cwd: modulePath,
            stdio: "inherit",
            env: hostBuildEnv,
          });
        }
      }
    },
    postStart: async (_forgeConfig, child) => {
      electronChild = child;
    },
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      // Resolve the target arch (cross-builds set npm_config_arch); fall back
      // to the host so non-cross builds keep their existing behavior.
      const targetArch = process.env.npm_config_arch ?? process.arch;

      copyNativeDependency("node-pty", buildPath);
      copyNativeDependency("node-addon-api", buildPath);
      copyNativeDependency("@parcel/watcher", buildPath);

      // Platform-specific native dependencies
      if (process.platform === "darwin") {
        const watcherPkg =
          targetArch === "x64"
            ? "@parcel/watcher-darwin-x64"
            : "@parcel/watcher-darwin-arm64";
        copyNativeDependency(watcherPkg, buildPath);
        copyNativeDependency("file-icon", buildPath);
        copyNativeDependency("p-map", buildPath);
      } else if (process.platform === "win32") {
        const watcherPkg =
          targetArch === "arm64"
            ? "@parcel/watcher-win32-arm64"
            : "@parcel/watcher-win32-x64";
        copyNativeDependency(watcherPkg, buildPath);
      } else if (process.platform === "linux") {
        const watcherPkg =
          targetArch === "arm64"
            ? "@parcel/watcher-linux-arm64-glibc"
            : "@parcel/watcher-linux-x64-glibc";
        copyNativeDependency(watcherPkg, buildPath);
      }

      // Copy @parcel/watcher's hoisted dependencies
      copyNativeDependency("micromatch", buildPath);
      copyNativeDependency("is-glob", buildPath);
      copyNativeDependency("detect-libc", buildPath);
      // Copy transitive dependencies (full chain)
      copyNativeDependency("braces", buildPath);
      copyNativeDependency("picomatch", buildPath);
      copyNativeDependency("is-extglob", buildPath);
      copyNativeDependency("fill-range", buildPath);
      copyNativeDependency("to-regex-range", buildPath);
      copyNativeDependency("is-number", buildPath);
      copyNativeDependency("better-sqlite3", buildPath);
      copyNativeDependency("bindings", buildPath);
      copyNativeDependency("file-uri-to-path", buildPath);
      copyNativeDependency("prebuild-install", buildPath);
    },
  },
  publishers: [
    new PublisherGithub({
      repository: {
        owner: "PostHog",
        name: "code",
      },
      draft: true,
      prerelease: false,
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/bootstrap.ts",
          config: "vite.main.config.mts",
          target: "main",
        },
        {
          entry: "src/main/preload.ts",
          config: "vite.preload.config.mts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.mts",
        },
      ],
    }),
  ],
};

export default config;
