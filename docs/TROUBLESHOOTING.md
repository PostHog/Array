# Troubleshooting

## Black screen during development

If the app launches but renders a blank/black screen, it's almost always a stale Vite cache.

### Fix

```sh
pnpm clean
pnpm dev
```

This clears all Vite caches, Turbo caches, and build output across every package in the monorepo, then starts fresh.

### Why this happens

Vite caches pre-bundled dependencies in `.vite/` and `node_modules/.vite/`. When dependencies change (e.g. after switching branches, updating packages, or modifying workspace packages), the cached bundles can become stale. The Electron renderer loads the old cached modules which fail silently, resulting in a black screen.

## Electron failed to install correctly

If you see this error when running `pnpm dev`:

```
Error: Electron failed to install correctly, please delete node_modules/electron and try installing again
```

The electron binary didn't download during install. Fix it by running the install script manually:

```bash
cd node_modules/electron && node install.js
```

Or nuke it and reinstall:

```bash
rm -rf node_modules/electron && pnpm install && cd node_modules/electron && node install.js
```

## Native module crash (libc++abi / Napi::Error)

If the app crashes with something like:

```
libc++abi: terminating due to uncaught exception of type Napi::Error
```

Native modules (like node-pty) need to be rebuilt for your Electron version.

### Fix

```bash
cd apps/code && npx electron-rebuild -f
```

## Codex agent crashes with GPU process errors

If you see repeated errors like:

```
[ERROR:gpu_process_host.cc(997)] GPU process exited unexpectedly: exit_code=5
[FATAL:gpu_data_manager_impl_private.cc(448)] GPU process isn't usable. Goodbye.
```

The codex-acp binary hasn't been downloaded. When it's missing, the app falls back to `npx` which spawns inside Electron's environment and triggers Chromium GPU process crashes.

### Fix

```bash
node apps/code/scripts/download-binaries.mjs
```

Then restart the app. This downloads the codex-acp binary to `apps/code/resources/codex-acp/`, which gets copied to `.vite/build/codex-acp/` during build.

## Database initialization failed (better-sqlite3)

If you see any of these errors on startup:

```
Database initialization failed Error: Could not locate the bindings file.
```

```
Database initialization failed Error: The module '.../better_sqlite3.node'
was compiled against a different Node.js version using
NODE_MODULE_VERSION 145. This version of Node.js requires
NODE_MODULE_VERSION 123.
```

```
Unhandled rejection Error: Unexpected error found when calling "initialize"
@postConstruct decorated method on class "DatabaseService"
```

The last one is the same failure wrapped by the DI container; the underlying cause (with the bindings paths it tried) is in `~/.posthog-code/logs-dev/main.log`.

The `better-sqlite3` native binary wasn't compiled for your Electron version. This commonly happens after a merge, branch switch or Electron upgrade because the postinstall rebuild can fail silently (`|| true`). It also happens whenever the binary was last rebuilt for plain Node, for example to run the workspace-server DB tests (see "One binary, two ABIs" below).

### Fix

```bash
cd apps/code && npx electron-rebuild -f
```

Then restart the app.

### If `electron-rebuild` itself crashes

The rebuild above can die before it compiles anything, with a stack trace inside yargs:

```
ReferenceError: require is not defined in ES module scope, you can use import instead
    at file:///.../node_modules/yargs/yargs:3:69
```

This happens when the hoisted `@electron/rebuild` resolves to a stale major whose yargs CLI no longer loads (`apps/code` wants `^4`; check yours with `node -p "require('./node_modules/@electron/rebuild/package.json').version"`). Because the rebuild line in `apps/code/scripts/postinstall.sh` ends in `|| true`, the failure is swallowed and the binary is never built.

Compile `better-sqlite3` directly with `node-gyp` against the Electron headers, which sidesteps the broken CLI:

```bash
ELECTRON_VERSION="$(node -p "require('./node_modules/electron/package.json').version")"
cd node_modules/better-sqlite3
npx node-gyp rebuild --release \
  --arch="$(node -p process.arch)" \
  --target="$ELECTRON_VERSION" \
  --dist-url=https://electronjs.org/headers
```

The ABI comes from the Electron headers (`--target` plus `--dist-url`), not your system Node, so the binary gets the right `NODE_MODULE_VERSION` even when the two differ. It lands at `node_modules/better-sqlite3/build/Release/better_sqlite3.node`. Restart the app.

Alternatively, skip compiling entirely and download the official Electron prebuild (no toolchain needed):

```bash
ELECTRON_VERSION="$(node -p "require('./node_modules/electron/package.json').version")"
cd node_modules/better-sqlite3
rm -rf build prebuilds
npx prebuild-install --runtime=electron --target="$ELECTRON_VERSION" --arch="$(node -p process.arch)"
```

### One binary, two ABIs (app vs tests)

There is a single `better-sqlite3` binary in the repo but two runtimes that load it:

- The Electron main process (`pnpm dev`, the packaged app) needs it compiled for **Electron's** ABI. The `apps/code` postinstall does this.
- The workspace-server DB tests run under plain Node via vitest and need it compiled for **your system Node's** ABI.

These ABIs differ, so the binary can only satisfy one side at a time and rebuilding for one breaks the other. The toggle is deliberate:

```bash
# Before running the workspace-server DB tests locally (CI does this in test.yml):
node scripts/rebuild-better-sqlite3-node.mjs

# Before running the app again, restore the Electron build:
pnpm --filter code postinstall
# (or any of the fixes above)
```

Symptoms map directly to the current state: the app failing with `DatabaseService` / `NODE_MODULE_VERSION` errors means the binary is in its Node state; `src/db/repositories/repositories.test.ts` failing with a `NODE_MODULE_VERSION` mismatch means it is in its Electron state. Note that `pnpm rebuild better-sqlite3` compiles for system Node, so it flips the binary to the test state even if you meant to fix the app.

## node-gyp failed to rebuild @parcel/watcher

If you see this error after pulling or switching branches:

```
Error: node-gyp failed to rebuild '/path/to/node_modules/@parcel/watcher'
```

`@parcel/watcher` ships prebuilt N-API binaries per platform (e.g. `@parcel/watcher-darwin-arm64`) and should not need recompilation. This error usually means a stale or partial install state is triggering a source rebuild that fails.

### Fix

```bash
rm -rf node_modules/@parcel/watcher
pnpm install
```

If that doesn't work, nuke and reinstall:

```bash
rm -rf node_modules && pnpm install
```

Do **not** run `npx @electron/rebuild` against `@parcel/watcher` — it doesn't need it and the rebuild will fail.

## `pnpm i` shows "Packages: -198"

You might see something like this every time you run `pnpm install`:

```
Packages: -198
```

This is cosmetic noise — nothing is broken. It's caused by `node-linker=hoisted` in `.npmrc`, which gives us a flat `node_modules` layout (required for Electron). With hoisted mode, pnpm reorganizes the flat layout on each install and reports the churn as packages added/removed. The packages aren't actually disappearing. Safe to ignore.
