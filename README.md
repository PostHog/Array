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

1. Export a GitHub token with `repo` scope as `GH_TOKEN`; this is consumed by Electron Forge's GitHub publisher (store it locally in `.envrc` and in the repo's secrets).
2. Run `pnpm run make` locally to sanity check artifacts, then bump `package.json`'s version (e.g., `pnpm version patch`).
3. Merge the version bump into `main`. The `Publish Release` GitHub Action auto-detects the new version, tags `vX.Y.Z`, runs `pnpm run publish`, and uploads the release artifacts. You can also run the workflow manually (`workflow_dispatch`) and supply a tag if you need to re-publish.

Set `ELECTRON_DISABLE_AUTO_UPDATE=1` if you ever need to ship a build with auto updates disabled.

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
