// Single source of truth for native modules (and their runtime-required
// transitive deps). pnpm hoists these to the root node_modules; the packaged
// app needs real copies next to the bundle.
//
//   - scripts/before-pack.ts stages them from the hoisted root into the app's
//     local node_modules before electron-builder collects files.
//   - electron-builder.ts re-includes them (`files`) and unpacks the
//     binary-bearing ones from the asar (`asarUnpack`).
//   - electron.vite.config.ts marks the native ones external so Vite leaves
//     them to be resolved from node_modules at runtime.

// Staged + packaged on every platform.
export const runtimeNativeModules = [
  "node-pty",
  "node-addon-api",
  "@parcel/watcher",
  "better-sqlite3",
  "bindings",
  "file-uri-to-path",
  "prebuild-install",
  "micromatch",
  "is-glob",
  "detect-libc",
  "braces",
  "picomatch",
  "is-extglob",
  "fill-range",
  "to-regex-range",
  "is-number",
];

// file-icon (and its p-map dependency) is only used on macOS.
export const macOnlyNativeModules = ["file-icon", "p-map"];

// The subset that ships compiled .node binaries and must be unpacked from asar.
const asarUnpackModules = [
  "node-pty",
  "@parcel/watcher",
  "file-icon",
  "better-sqlite3",
  "bindings",
  "file-uri-to-path",
];

// Modules Vite must not bundle (resolved from the staged node_modules at runtime).
export const buildExternals = [
  "node-pty",
  "@parcel/watcher",
  "file-icon",
  "better-sqlite3",
];

// electron-builder ships the whole @parcel scope so the platform-specific
// @parcel/watcher-<plat>-<arch> staged by before-pack is covered too.
const scopeOf = (name: string) =>
  name.startsWith("@parcel/") ? "@parcel" : name;

export const packagedFileGlobs = [
  ...runtimeNativeModules,
  ...macOnlyNativeModules,
].map((name) => `node_modules/${scopeOf(name)}/**/*`);

export const asarUnpackGlobs = asarUnpackModules.map(
  (name) => `node_modules/${scopeOf(name)}/**`,
);
