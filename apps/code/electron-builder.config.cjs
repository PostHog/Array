"use strict";

const skipNotarize =
  process.env.SKIP_NOTARIZE === "1" || !process.env.APPLE_TEAM_ID;

/** @type {import('electron-builder').Configuration} */
module.exports = {
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

  beforePack: "./scripts/before-pack.cjs",

  files: [
    ".vite/build/**/*",
    ".vite/renderer/**/*",
    "package.json",
    "!node_modules/**/*",
    "node_modules/node-pty/**/*",
    "node_modules/node-addon-api/**/*",
    "node_modules/@parcel/**/*",
    "node_modules/better-sqlite3/**/*",
    "node_modules/bindings/**/*",
    "node_modules/file-uri-to-path/**/*",
    "node_modules/file-icon/**/*",
    "node_modules/p-map/**/*",
    "node_modules/prebuild-install/**/*",
    "node_modules/micromatch/**/*",
    "node_modules/is-glob/**/*",
    "node_modules/detect-libc/**/*",
    "node_modules/braces/**/*",
    "node_modules/picomatch/**/*",
    "node_modules/is-extglob/**/*",
    "node_modules/fill-range/**/*",
    "node_modules/to-regex-range/**/*",
    "node_modules/is-number/**/*",
  ],

  asarUnpack: [
    "**/*.node",
    "**/spawn-helper",
    ".vite/build/claude-cli/**",
    ".vite/build/plugins/posthog/**",
    ".vite/build/codex-acp/**",
    ".vite/build/grammars/**",
    "node_modules/node-pty/**",
    "node_modules/@parcel/**",
    "node_modules/file-icon/**",
    "node_modules/better-sqlite3/**",
    "node_modules/bindings/**",
    "node_modules/file-uri-to-path/**",
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
