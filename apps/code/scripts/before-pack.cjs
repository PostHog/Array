"use strict";

const { cpSync, existsSync, mkdirSync, rmSync } = require("node:fs");
const path = require("node:path");
const { Arch } = require("electron-builder");

function copyDep(name, rootNodeModules, localNodeModules) {
  const src = path.join(rootNodeModules, name);
  if (!existsSync(src)) {
    const localSrc = path.join(localNodeModules, name);
    if (existsSync(localSrc)) {
      console.log(
        `[before-pack] "${name}" already in local node_modules, skipping`,
      );
      return true;
    }
    console.warn(
      `[before-pack] "${name}" not found in root or local node_modules, skipping`,
    );
    return false;
  }

  const dest = path.join(localNodeModules, name);
  const parentDir = path.dirname(dest);
  mkdirSync(parentDir, { recursive: true });
  rmSync(dest, { recursive: true, force: true });
  cpSync(src, dest, { recursive: true, dereference: true });
  console.log(`[before-pack] staged "${name}"`);
  return true;
}

function copyRequiredDep(name, rootNodeModules, localNodeModules) {
  if (!copyDep(name, rootNodeModules, localNodeModules)) {
    throw new Error(
      `[before-pack] required native dependency "${name}" not found in node_modules`,
    );
  }
}

module.exports = async function beforePack(context) {
  const platformName = context.packager.platform.name;
  const arch = context.arch;

  const rootNodeModules = path.resolve(__dirname, "../../../node_modules");
  const localNodeModules = path.resolve(__dirname, "../node_modules");

  console.log(`[before-pack] platform=${platformName} arch=${arch}`);
  console.log(`[before-pack] root node_modules: ${rootNodeModules}`);
  console.log(`[before-pack] local node_modules: ${localNodeModules}`);

  const requiredDeps = ["node-pty", "better-sqlite3", "@parcel/watcher"];
  const optionalDeps = [
    "node-addon-api",
    "micromatch",
    "is-glob",
    "detect-libc",
    "braces",
    "picomatch",
    "is-extglob",
    "fill-range",
    "to-regex-range",
    "is-number",
    "bindings",
    "file-uri-to-path",
    "prebuild-install",
  ];

  for (const dep of requiredDeps) {
    copyRequiredDep(dep, rootNodeModules, localNodeModules);
  }
  for (const dep of optionalDeps) {
    copyDep(dep, rootNodeModules, localNodeModules);
  }

  if (platformName === "mac") {
    const watcherPkg =
      arch === Arch.x64
        ? "@parcel/watcher-darwin-x64"
        : "@parcel/watcher-darwin-arm64";
    copyRequiredDep(watcherPkg, rootNodeModules, localNodeModules);
    copyDep("file-icon", rootNodeModules, localNodeModules);
    copyDep("p-map", rootNodeModules, localNodeModules);
  } else if (platformName === "win") {
    const watcherPkg =
      arch === Arch.arm64
        ? "@parcel/watcher-win32-arm64"
        : "@parcel/watcher-win32-x64";
    copyRequiredDep(watcherPkg, rootNodeModules, localNodeModules);
  } else if (platformName === "linux") {
    const watcherPkg =
      arch === Arch.arm64
        ? "@parcel/watcher-linux-arm64-glibc"
        : "@parcel/watcher-linux-x64-glibc";
    copyRequiredDep(watcherPkg, rootNodeModules, localNodeModules);
  }

  const watcherBuild = path.join(localNodeModules, "@parcel/watcher/build");
  if (existsSync(watcherBuild)) {
    rmSync(watcherBuild, { recursive: true, force: true });
    console.log("[before-pack] removed @parcel/watcher/build");
  }
};
