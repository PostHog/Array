import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";
import type { ForgeConfig } from "@electron-forge/shared-types";

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: "Array",
    executableName: "Array",
    icon: "./build/app-icon", // Forge adds .icns/.ico/.png based on platform
    extraResource: existsSync("build/Assets.car") ? ["build/Assets.car"] : [],
    extendInfo: existsSync("build/Assets.car")
      ? {
          CFBundleIconName: "Icon",
        }
      : {},
  },
  rebuildConfig: {},
  makers: [
    new MakerDMG({
      icon: "./build/app-icon.icns",
      format: "ULFO",
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
  },
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
