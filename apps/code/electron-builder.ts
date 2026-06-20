import { createRequire } from "node:module";
import type { Configuration } from "electron-builder";
import { asarUnpackGlobs, packagedFileGlobs } from "./runtime-dependencies";
import beforePack from "./scripts/before-pack";

const require = createRequire(import.meta.url);

const skipNotarize =
  process.env.SKIP_NOTARIZE === "1" || !process.env.APPLE_TEAM_ID;

const config: Configuration = {
  // Original release bundle id; changing it breaks existing installs' data dir and Keychain entries.
  appId: "com.posthog.array",
  productName: "PostHog Code",
  executableName: "PostHog Code",

  directories: {
    output: "out",
    buildResources: "build",
  },

  electronVersion: require("electron/package.json").version,
  npmRebuild: false,
  nodeGypRebuild: false,
  generateUpdatesFilesForAllChannels: true,

  beforePack,

  files: [
    ".vite/build/**/*",
    ".vite/renderer/**/*",
    "package.json",
    "!node_modules/**/*",
    ...packagedFileGlobs,
  ],

  asarUnpack: [
    "**/*.node",
    "**/spawn-helper",
    ".vite/build/claude-cli/**",
    ".vite/build/plugins/posthog/**",
    ".vite/build/codex-acp/**",
    ".vite/build/grammars/**",
    ...asarUnpackGlobs,
  ],

  extraResources: [
    { from: "build/app-icon.png", to: "app-icon.png" },
    { from: "build/Assets.car", to: "Assets.car" },
  ],

  protocols: [
    {
      name: "PostHog Code",
      schemes: ["posthog-code"],
    },
  ],

  mac: {
    target: ["dmg", "zip"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder interpolation tokens, not JS template literals
    artifactName: "PostHog-Code-${version}-${arch}-mac.${ext}",
    icon: "build/app-icon.icns",
    category: "public.app-category.productivity",
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: "build/entitlements.mac.plist",
    entitlementsInherit: "build/entitlements.mac.inherit.plist",
    extendInfo: {
      CFBundleIconName: "Icon",
    },
    notarize: skipNotarize ? false : { teamId: process.env.APPLE_TEAM_ID },
  },

  dmg: {
    format: "ULFO",
    size: "4g",
    background: "build/dmg-background.png",
    icon: "build/app-icon.icns",
    iconSize: 80,
    window: { width: 560, height: 380 },
    contents: [
      { x: 104, y: 55, type: "file" },
      { x: 104, y: 243, type: "link", path: "/Applications" },
    ],
  },

  win: {
    target: ["nsis", "squirrel"],
    // biome-ignore lint/suspicious/noTemplateCurlyInString: electron-builder interpolation tokens, not JS template literals
    artifactName: "PostHog-Code-${version}-${arch}-win.${ext}",
    icon: "build/app-icon.ico",
  },

  nsis: {
    oneClick: false,
    deleteAppDataOnUninstall: false,
  },

  squirrelWindows: {
    name: "PostHogCode",
  },

  linux: {
    target: ["AppImage", "deb", "rpm"],
    icon: "build/app-icon.png",
    category: "Development",
    mimeTypes: ["x-scheme-handler/posthog-code"],
  },

  deb: {
    packageName: "posthog-code",
    maintainer: "PostHog <eng@posthog.com>",
    packageCategory: "devel",
  },

  rpm: {
    packageName: "posthog-code",
  },

  publish: {
    provider: "github",
    owner: "PostHog",
    repo: "code",
    releaseType: "draft",
  },
};

export default config;
