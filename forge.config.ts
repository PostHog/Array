import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { PublisherGithub } from "@electron-forge/publisher-github";
import type { ForgeConfig } from "@electron-forge/shared-types";

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
    appleId: appleId!,
    appleIdPassword: appleIdPassword!,
    teamId: appleTeamId!,
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
const osxSignConfig = shouldSignMacApp
  ? ({
      identity: appleCodesignIdentity!,
    } satisfies Record<string, unknown>)
  : undefined;

function copyNativeDependency(
  dependency: string,
  destinationRoot: string,
): void {
  const source = path.resolve("node_modules", dependency);
  if (!existsSync(source)) {
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

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: "{**/*.node,node_modules/@recallai/**}",
    },
    prune: false,
    name: "Array",
    executableName: "Array",
    icon: "./build/app-icon", // Forge adds .icns/.ico/.png based on platform
    appBundleId: "com.posthog.array",
    appCategoryType: "public.app-category.productivity",
    extraResource: existsSync("build/Assets.car") ? ["build/Assets.car"] : [],
    extendInfo: existsSync("build/Assets.car")
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
      ...(shouldSignMacApp
        ? {
            "code-sign": {
              "signing-identity": appleCodesignIdentity!,
              identifier: "com.posthog.array",
            },
          }
        : {}),
    }),
    new MakerZIP({}, ["darwin", "linux", "win32"]),
  ],
  hooks: {
    generateAssets: async () => {
      // Generate ICNS from source PNG
      if (existsSync("build/icon@3x.png")) {
        console.log("Generating ICNS icon...");
        execSync("bash scripts/generate-icns.sh", { stdio: "inherit" });
      }

      // Compile liquid glass icon to Assets.car
      if (existsSync("build/icon.icon")) {
        console.log("Compiling liquid glass icon...");
        execSync("bash scripts/compile-glass-icon.sh", { stdio: "inherit" });
      }
    },
    prePackage: async () => {
      // Build native modules for DMG maker on Node.js 22
      const modules = ["macos-alias", "fs-xattr"];

      for (const module of modules) {
        const modulePath = `node_modules/${module}`;
        if (existsSync(modulePath)) {
          console.log(`Building native module: ${module}`);
          execSync("npm install", { cwd: modulePath, stdio: "inherit" });
        }
      }
    },
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      copyNativeDependency("node-pty", buildPath);
      copyNativeDependency("@recallai/desktop-sdk", buildPath);
    },
  },
  publishers: [
    new PublisherGithub({
      repository: {
        owner: "PostHog",
        name: "Array",
      },
      draft: false,
      prerelease: false,
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/index.ts",
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
