# PostHog - Array

The PostHog desktop task manager

## The Goal

Free product engineers from distractions so they can focus on what they love: building great features. By using agents to transform all data collected across PostHog’s products into actionable “tasks,” then exposing them with that context through a single interface, we can automate all the chores and save developers hours every day, giving them more time to ship.

## Development

### Prerequisites

- Node.js 22+
- pnpm 9+

### Setup

```bash
# Install pnpm if you haven't already
npm install -g pnpm

# Install dependencies
pnpm install

# Run in development mode
pnpm run start

# Build for production
pnpm run make

# Other useful commands
pnpm run check:write       # Linting & typecheck
```

### Building Distributables

To create production distributables (DMG, ZIP):

```bash
# Package the app
pnpm package

# Create distributables (DMG + ZIP)
pnpm make
```

Output will be in:
- `out/Array-darwin-arm64/Array.app` - Packaged app
- `out/make/Array-*.dmg` - macOS installer
- `out/make/zip/` - ZIP archives

**Note:** Native modules for the DMG maker are automatically compiled via the `prePackage` hook. If you need to manually rebuild them, run:

```bash
pnpm build-native
```

### Auto Updates & Releases

Array uses Electron's built-in `autoUpdater` pointed at the public `update.electronjs.org` service for `PostHog/Array`. Every time a non-draft GitHub release is published with the platform archives, packaged apps will automatically download and install the newest version on macOS and Windows.

Publishing a new release:

1. Export a GitHub token with `repo` scope as `GH_PUBLISH_TOKEN`; set both `GH_TOKEN` and `GITHUB_TOKEN` to its value locally (e.g., in `.envrc`). In GitHub, store the token as the `GH_PUBLISH_TOKEN` repository secret.
2. Run `pnpm run make` locally to sanity check artifacts, then bump `package.json`'s version (e.g., `pnpm version patch`).
3. Merge the version bump into `main`. The `Publish Release` GitHub Action auto-detects the new version, tags `vX.Y.Z`, runs `pnpm run publish`, and uploads the release artifacts. You can also run the workflow manually (`workflow_dispatch`) and supply a tag if you need to re-publish.

Set `ELECTRON_DISABLE_AUTO_UPDATE=1` if you ever need to ship a build with auto updates disabled.

### macOS Code Signing & Notarization

macOS builds are automatically signed (and optionally notarized) when the relevant environment variables are present. We standardise on Apple ID + app-specific password credentials for notarization:

```bash
# Required for code signing
export APPLE_CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"

# Notarytool authentication
export APPLE_ID="appleid@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
```

The signing step uses hardened runtime with the entitlements in `build/entitlements.mac.plist` and will sign the DMG plus the zipped `.app`. When the notarization variables are present, packages are also notarized. Without these variables the build proceeds unsigned, which is convenient for local development.

For CI releases, add the same values as GitHub Actions repository secrets:

- `APPLE_CODESIGN_IDENTITY`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_CODESIGN_CERT_BASE64` - Base64 encoded `.p12` export of your Developer ID Application certificate
- `APPLE_CODESIGN_CERT_PASSWORD` - Password used when exporting the `.p12`
- `APPLE_CODESIGN_KEYCHAIN_PASSWORD` - Password for the temporary keychain created in CI

The `Publish Release` workflow will automatically sign and notarize when these secrets are present.

> If you prefer API-key or keychain profile credentials for notarization, the Forge configuration already supports them—add the matching env vars locally and in CI instead of the defaults above.

### Liquid Glass Icon (macOS 26+)

The app supports macOS liquid glass icons for a modern, layered appearance. The icon configuration is in `build/icon.icon/`.

**Compiling the liquid glass icon requires Xcode** (Command Line Tools are not sufficient):

```bash
# Compile liquid glass icon (requires Xcode)
bash scripts/compile-glass-icon.sh
```

If you don't have Xcode installed, the build will automatically fall back to the standard `.icns` icon. To enable liquid glass icons:

1. Install Xcode from the App Store
2. Run the compile script above, or
3. Compile `Assets.car` on a machine with Xcode and commit it to the repo

The `generateAssets` hook will automatically attempt to compile the icon during packaging if Xcode is available.

### Environment Variables

You can set these environment variables instead of entering credentials in the app:

- `POSTHOG_API_KEY` - Your PostHog personal API key
- `POSTHOG_API_HOST` - PostHog instance URL (defaults to https://us.posthog.com)

## Architecture

- **Electron** - Desktop app framework
- **React** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Zustand** - State management - we should probably switch to kea
- **Vite** - Build tool

## Project Structure

```
array/
├── src/
│   ├── main/           # Electron main process
│   ├── renderer/       # React app
│   ├── api/            # API client
│   └── shared/         # Shared types
├── dist/               # Build output
└── release/            # Packaged apps
```

## Keyboard Shortcuts

- `↑/↓` - Navigate tasks
- `Enter` - Open selected task
- `⌘R` - Refresh task list
- `⌘⇧[/]` - Switch between tabs
- `⌘W` - Close current tab
