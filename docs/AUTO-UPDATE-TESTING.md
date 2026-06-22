# Testing Auto-Update Locally

This explains how to exercise the real auto-update flow (check, download, install, relaunch) on your own machine, against a local feed, without cutting a GitHub release. For how releases and versioning actually work in production, see [UPDATES.md](./UPDATES.md).

The same harness runs nightly in CI (`.github/workflows/code-update-e2e.yml`) on a signed macOS build.

## What this covers

Auto-update is macOS and Windows only (`isSupported` in `apps/code/src/main/platform-adapters/electron-updater.ts`). This guide is macOS, which is where the harness and the nightly job run.

The flow under test: a packaged old build checks a local feed, downloads a newer build, and Squirrel.Mac swaps the app bundle in place and relaunches into the new version.

## What you need

- A packaged build (not `pnpm dev`). Auto-update only runs when `app.isPackaged` is true.
- For the full install and relaunch: a Developer ID signing identity. Squirrel.Mac only swaps a bundle whose signature matches the running app's designated requirement, so both builds must be signed with the same identity. Set `CSC_LINK` / `CSC_KEY_PASSWORD`, or have a Developer ID cert in your login keychain.
  - Without a matching identity you can still watch check, available, download and ready, but the final swap needs the signature. If you can't sign locally, skip the local build and pull the CI-signed pair instead (see below).
- Notarization is intentionally skipped (`SKIP_NOTARIZE=1`). It is a Gatekeeper concern for first launch of a downloaded app, not what the in-place update verifies, and a locally built bundle carries no quarantine attribute.

## The harness

| Piece | Role |
| --- | --- |
| `apps/code/scripts/dev-update/build-pair.sh` | Builds a signed `2.0.0` feed plus a runnable signed `1.0.0` app |
| `apps/code/scripts/dev-update/serve.mjs` | Dependency-free, range-capable static server for the feed |
| `apps/code/tests/e2e/tests/update.spec.ts` | Two-phase Playwright test: drive download and install, then assert the swap and relaunch |
| `POSTHOG_E2E_UPDATE_FEED` env | When set, the updater points at this URL instead of GitHub (gated, inert in production) |
| `apps/code/tests/e2e/playwright.update.config.ts` | Dedicated Playwright config; the only place the update spec runs |
| `globalThis.__e2eUpdates` | Set in the main process when `POSTHOG_E2E_UPDATE_FEED` is present; lets the test drive `check` / `download` / `install` / `status` |

## Build the pair locally

```bash
bash apps/code/scripts/dev-update/build-pair.sh
```

This runs `electron-vite build` once, then builds twice with `electron-builder`:

- The new `2.0.0` artifacts are copied to `apps/code/out/dev-update-feed/` (`latest-mac.yml`, the zip and its blockmap). This is the feed.
- The old `1.0.0` app is left at `apps/code/out/mac-arm64/PostHog Code.app`. This is what you run.

Override the versions if you want (`2.0.0` must be greater than `1.0.0`):

```bash
OLD_VERSION=1.0.0 NEW_VERSION=2.0.0 bash apps/code/scripts/dev-update/build-pair.sh
```

This takes a few minutes and may prompt for keychain access to sign.

## Or: pull a signed pair from CI (no local signing)

If you don't have a Developer ID cert, `build-pair.sh` produces unsigned builds and the swap won't complete. The nightly run signs both with PostHog's identity and uploads them as two separate artifacts. Squirrel verifies signatures cryptographically (it does not need the cert in your keychain), so the pulled pair updates locally just like a real release.

Drop them into the same paths the local build produces, then use the run sections below unchanged:

```bash
# latest green run
RUN=$(gh run list --workflow=code-update-e2e.yml --status success -L 1 \
  --json databaseId -q '.[0].databaseId')

# old 1.0.0 app -> apps/code/out/mac-arm64/PostHog Code.app
gh run download "$RUN" -n update-old-build-1.0.0 -D /tmp/upd-old
rm -rf apps/code/out/mac-arm64 && mkdir -p apps/code/out/mac-arm64
ditto -x -k "/tmp/upd-old/PostHog-Code-1.0.0-arm64-mac.zip" apps/code/out/mac-arm64
# harmless if already clear; needed only if you downloaded via the browser
xattr -dr com.apple.quarantine "apps/code/out/mac-arm64/PostHog Code.app"

# new 2.0.0 feed -> apps/code/out/dev-update-feed/
rm -rf apps/code/out/dev-update-feed
gh run download "$RUN" -n update-new-build-2.0.0 -D apps/code/out/dev-update-feed
```

The builds are signed but not notarized, so launch by the binary path (the manual section does this); `open`-ing the `.app` may trip Gatekeeper.

## 2a. Run it automated (Playwright)

The spec starts its own feed server, copies the `1.0.0` app to a disposable run dir (so a rerun starts clean), drives the full flow and asserts the relaunched app is `2.0.0`.

```bash
pnpm --filter code exec playwright test \
  --config=tests/e2e/playwright.update.config.ts
```

The spec runs only through this dedicated config. The general e2e suite excludes it by path (`testIgnore` in `playwright.config.ts`), so it never runs there without a feed.

## 2b. Run it manually (real UI)

Serve the feed in one terminal:

```bash
node apps/code/scripts/dev-update/serve.mjs apps/code/out/dev-update-feed 8788
```

Launch the `1.0.0` app pointed at it in another terminal:

```bash
POSTHOG_E2E_UPDATE_FEED=http://127.0.0.1:8788 \
  "apps/code/out/mac-arm64/PostHog Code.app/Contents/MacOS/PostHog Code"
```

The app checks on launch and the update banner shows `2.0.0` is available. Open it, click Download, watch progress, then Restart. The app quits, swaps and relaunches into `2.0.0`.

A manual run swaps `out/mac-arm64` in place, so rerun `build-pair.sh` (or just the old build) to reset to `1.0.0` before testing again.

## Verifying the result

- Running version: open the in-app About, or read the bundle:
  ```bash
  plutil -extract CFBundleShortVersionString raw \
    "apps/code/out/mac-arm64/PostHog Code.app/Contents/Info.plist"
  ```
- Update logs are in the main log:
  ```bash
  tail -f ~/.posthog-code/logs/main.log
  ```

## CI

`code-update-e2e.yml` runs the same spec nightly on `macos-15` with the real signing secrets, and on demand:

```bash
gh workflow run "Code Update E2E (macOS)"
```

It builds the pair, runs the spec via `playwright.update.config.ts`, and asserts exactly one test actually ran, so a missing feed or a silent skip fails the job. Every run renders a proof summary on the run page and uploads, on pass or fail: the proof manifest, main log and Squirrel ShipIt cache (artifact `update-e2e-macos`), plus the two signed builds as their own artifacts (`update-old-build-1.0.0`, `update-new-build-2.0.0`) you can pull as shown above.

## Cleanup

```bash
rm -rf apps/code/out/dev-update-feed apps/code/out/e2e-update-run
```
