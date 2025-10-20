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
pnpm run dev

# Build for production
pnpm run build

# Other useful commands
pnpm run typecheck  # Type checking
pnpm run lint       # Linting
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