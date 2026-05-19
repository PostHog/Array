# PostHog Code

The PostHog desktop task manager

## The Goal

Free product engineers from distractions so they can focus on what they love: building great features. By using agents to transform all data collected across PostHog's products into actionable "tasks," then exposing them with that context through a single interface, we can automate all the chores and save developers hours every day, giving them more time to ship.

## Development

### Prerequisites

- Node.js 22+
- pnpm 10+

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

### BerkeleyMono Font (PostHog employees)

PostHog Code uses [Berkeley Mono](https://usgraphics.com/products/berkeley-mono) as its primary font, falling back to JetBrains Mono if the files aren't present. The font is licensed and not committed to the repo — it's downloaded from S3 during CI builds.

To use it locally, go to the PostHog Code app assets S3 bucket in the AWS console, download the `.woff2` files from the `fonts/` folder, and place them in:

```
apps/code/assets/fonts/BerkeleyMono/
```

The directory is gitignored, so these files won't be committed.

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
code/
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

### Building Distributables

To create production distributables (DMG, ZIP):

```bash
# Package the app
pnpm package

# Create distributables (DMG + ZIP)
pnpm make
```

Output will be in:

- `out/PostHog Code-darwin-arm64/PostHog Code.app` - Packaged app
- `out/make/PostHog Code-*.dmg` - macOS installer
- `out/make/zip/` - ZIP archives

**Note:** Native modules for the DMG maker are automatically compiled via the `prePackage` hook. If you need to manually rebuild them, run:

```bash
pnpm build-native
```

### Auto Updates & Releases

PostHog Code uses Electron's built-in `autoUpdater` pointed at the public `update.electronjs.org` service for `PostHog/code`. Every time a non-draft GitHub release is published with the platform archives, packaged apps will automatically download and install the newest version on macOS and Windows.

There are three ways a release can fire:

1. **Scheduled (default)** — automatic at 17:00 and 01:00 UTC.
2. **Hotfix** — add the `Create release` label to a PR before it merges. On merge, the tag workflow runs immediately and ships whatever is on `main`.
3. **Manual** — run `Tag PostHog Code Release` via `workflow_dispatch` from the Actions tab.

Local prep (only needed for one-off manual builds):

1. Export a GitHub token with `repo` scope as `GH_PUBLISH_TOKEN`; set both `GH_TOKEN` and `GITHUB_TOKEN` to its value locally (e.g., in `.envrc`). In GitHub, store the token as the `GH_PUBLISH_TOKEN` repository secret.
2. Run `pnpm run make` to sanity check artifacts.

Set `ELECTRON_DISABLE_AUTO_UPDATE=1` if you ever need to ship a build with auto updates disabled.

### macOS Code Signing & Notarization

macOS packages are signed and notarized automatically when these environment variables are present:

```bash
export APPLE_CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="appleid@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
```

For CI releases, configure matching GitHub Actions secrets:

- `APPLE_CODESIGN_IDENTITY`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `APPLE_CODESIGN_CERT_BASE64` – Base64-encoded `.p12` export of the Developer ID Application certificate (include the private key)
- `APPLE_CODESIGN_CERT_PASSWORD` – Password used when exporting the `.p12`
- `APPLE_CODESIGN_KEYCHAIN_PASSWORD` – Password for the temporary keychain the workflow creates on the runner

The `Publish Release` workflow imports the certificate into a temporary keychain, signs each artifact with hardened runtime enabled (using Electron's default entitlements), and notarizes it before upload whenever these secrets are available.

For local testing, copy `codesign.env.example` to `.env.codesign`, fill in the real values, and load it before running `pnpm run make`:

```bash
set -a
source .env.codesign
set +a
pnpm run make
```

Set `SKIP_NOTARIZE=1` if you need to generate signed artifacts without submitting to Apple (e.g., while debugging credentials):

```bash
SKIP_NOTARIZE=1 pnpm run make
```

## Workspace Configuration (posthog-code.json)

PostHog Code supports per-repository configuration through a `posthog-code.json` file. This lets you define scripts that run automatically when workspaces are created or destroyed.

### File Locations

PostHog Code searches for configuration in this order (first match wins):

1. `.posthog-code/{workspace-name}/posthog-code.json` - Workspace-specific config
2. `posthog-code.json` - Repository root config

### Schema

```json
{
  "scripts": {
    "init": "npm install",
    "start": ["npm run server", "npm run client"],
    "destroy": "docker-compose down"
  }
}
```

| Script | When it runs | Behavior |
|--------|--------------|----------|
| `init` | Workspace creation | Runs first, fails fast (stops on error) |
| `start` | After init completes | Continues even if scripts fail |
| `destroy` | Workspace deletion | Runs silently before cleanup |

Each script can be a single command string or an array of commands. Commands run sequentially in dedicated terminal sessions.

### Examples

Install dependencies on workspace creation:
```json
{
  "scripts": {
    "init": "pnpm install"
  }
}
```

Start development servers:
```json
{
  "scripts": {
    "init": ["pnpm install", "pnpm run build"],
    "start": ["pnpm run dev", "pnpm run storybook"]
  }
}
```

Clean up Docker containers:
```json
{
  "scripts": {
    "destroy": "docker-compose down -v"
  }
}
```

## Workspace Environment Variables

PostHog Code automatically sets environment variables in all workspace terminals and scripts. These are available in `init`, `start`, and `destroy` scripts, as well as any terminal sessions opened within a workspace.

| Variable | Description | Example |
|----------|-------------|---------|
| `POSTHOG_CODE_WORKSPACE_NAME` | Worktree name, or folder name in root mode | `my-feature-branch` |
| `POSTHOG_CODE_WORKSPACE_PATH` | Absolute path to the workspace | `/Users/dev/.posthog-code/worktrees/repo/my-feature` |
| `POSTHOG_CODE_ROOT_PATH` | Absolute path to the repository root | `/Users/dev/repos/my-project` |
| `POSTHOG_CODE_DEFAULT_BRANCH` | Default branch detected from git | `main` |
| `POSTHOG_CODE_WORKSPACE_BRANCH` | Initial branch when workspace was created | `posthog-code/my-feature` |
| `POSTHOG_CODE_WORKSPACE_PORTS` | Comma-separated list of allocated ports | `50000,50001,...,50019` |
| `POSTHOG_CODE_WORKSPACE_PORTS_RANGE` | Number of ports allocated | `20` |
| `POSTHOG_CODE_WORKSPACE_PORTS_START` | First port in the range | `50000` |
| `POSTHOG_CODE_WORKSPACE_PORTS_END` | Last port in the range | `50019` |

Note: `POSTHOG_CODE_WORKSPACE_BRANCH` reflects the branch at workspace creation time. If you or the agent checks out a different branch, this variable will still show the original branch name.

### Port Allocation

Each workspace is assigned a unique range of 20 ports starting from port 50000. The allocation is deterministic based on the task ID, so the same workspace always receives the same ports across restarts.

### Usage Examples

Use ports in your start scripts:
```json
{
  "scripts": {
    "start": "npm run dev -- --port $POSTHOG_CODE_WORKSPACE_PORTS_START"
  }
}
```

Reference the workspace path:
```bash
echo "Working in: $POSTHOG_CODE_WORKSPACE_NAME"
echo "Root repo: $POSTHOG_CODE_ROOT_PATH"
```
