# PostHog Mobile App

React Native mobile app built with Expo and expo-router.

## Quick Start

From the **repository root**:

```bash
# Install dependencies
pnpm mobile:install

# Build and run on iOS simulator
pnpm mobile:run:ios

# Start the development server (after initial build)
pnpm mobile:start
```

## Tech Stack

- [Expo](https://expo.dev) - Build tooling, native APIs, OTA updates
- [expo-router](https://docs.expo.dev/router/introduction/) - File-based routing
- [NativeWind](https://www.nativewind.dev/) - Tailwind CSS for React Native
- [React Query](https://tanstack.com/query) - Async data fetching and caching
- [Zustand](https://zustand-demo.pmnd.rs/) - Client state management (UI state, selections, local flags)
- [Phosphor Icons](https://phosphoricons.com/) - Icon library

## Architecture

### Feature Folders

Code is organized by feature in `src/features/`. Each feature is self-contained with its own components, hooks, stores, and API logic.

```
src/features/
├── auth/           # Authentication & user session
│   ├── hooks/
│   ├── lib/
│   ├── stores/
│   └── types.ts
├── chat/           # PostHog AI chat interface
│   ├── components/
│   ├── hooks/
│   ├── stores/
│   └── types.ts
├── conversations/  # PostHog AI conversation list & management
│   ├── api.ts
│   ├── components/
│   ├── hooks/
│   └── stores/
└── tasks/          # Task management
    ├── api.ts
    ├── components/
    ├── hooks/
    └── stores/
```

### File-Based Routing

Routes for the screens are defined by the file structure in `src/app/` using expo-router. 

- `(tabs)/` - Parentheses create a layout group (tab navigator)
- `_layout.tsx` - Configures the navigator for that directory
- `[id].tsx` - Square brackets define dynamic route parameters
- Stacks and modals live outside tab group, configured in `_layout.tsx`

```
src/app/
├── _layout.tsx        # Root layout
├── index.tsx          # Entry redirect
├── auth.tsx           # Auth screen (unauthenticated)
├── (tabs)/            # Tabs group
│   ├── _layout.tsx    # Layout for all tabs
│   ├── index.tsx      # Home tab (Conversations)
│   ├── tasks.tsx      # Tasks tab
│   └── settings.tsx   # Settings tab
├── chat/              # Chat stack
│   ├── index.tsx      # New chat
│   └── [id].tsx       # Chat by ID (dynamic route)
└── task/              # Task stack
    ├── index.tsx      # New task
    └── [id].tsx       # Task by ID (dynamic route)
```

### Shared Code

```
src/
├── components/     # Reusable UI components (Text, etc.)
└── lib/
    ├── posthog.ts  # Analytics setup
    ├── queryClient.ts  # React Query client
    ├── theme.ts    # Design tokens
    └── logger.ts   # Logger setup
```

## Prerequisites

- Node.js 22+
- pnpm 10.23.0
- Xcode (for iOS development)
- Android Studio (for Android development)
- EAS CLI: `npm install -g eas-cli`

## Commands

### From Repository Root

**Development server:**
```bash
pnpm mobile:start              # Start Expo dev server
pnpm mobile:start:clear        # Start with cleared Metro cache
```

**Build and run:**
```bash
pnpm mobile:run:ios            # iOS simulator
pnpm mobile:run:ios:device     # iOS device (requires Apple Developer account)
pnpm mobile:run:android        # Android emulator/device
```

**Native code generation:**
```bash
pnpm mobile:prebuild           # Generate ios/ and android/ folders
pnpm mobile:prebuild:clean     # Delete and regenerate (when adding native deps)
```

**EAS builds:**
```bash
pnpm mobile:build:dev          # Development build (iOS, cloud)
pnpm mobile:build:dev:local    # Development build (iOS, local)
pnpm mobile:build:preview      # Preview build (iOS)
pnpm mobile:build:production   # Production build (iOS)
```

**TestFlight:**
```bash
pnpm mobile:testflight         # Submit to TestFlight
```

**Utilities:**
```bash
pnpm mobile:install            # Install mobile dependencies
pnpm mobile:lint               # Run Biome check
pnpm mobile:format             # Run Biome format
```

### From apps/mobile/ Directory

```bash
cd apps/mobile

# Development server
npx expo start
npx expo start --clear

# Build and run
npx expo run:ios
npx expo run:ios --device
npx expo run:android
npx expo run:android --device

# Generate native code
npx expo prebuild
npx expo prebuild --clean

# EAS builds (iOS)
npx eas build --profile development --platform ios
npx eas build --profile development --platform ios --local
npx eas build --profile preview --platform ios
npx eas build --profile production --platform ios

# EAS builds (Android)
npx eas build --profile development --platform android
npx eas build --profile preview --platform android
npx eas build --profile production --platform android

# TestFlight
npx testflight
npx eas submit --platform ios

# Linting
pnpm lint
pnpm lint:fix
pnpm format
```

## Prebuild Explained

`expo prebuild` generates the native `ios/` and `android/` folders from your Expo configuration.

**When to run `prebuild`:**
- First time setting up the project
- After adding/removing native dependencies (e.g., `expo-camera`, `react-native-maps`)
- After changing `app.json` iOS/Android configuration
- After updating Expo SDK version

**When to use `--clean`:**
- Switching between Expo SDK versions
- Native build is failing and you want a fresh start
- You've made manual changes to native files that you want to discard

The `--clean` flag removes existing `ios/` and `android/` directories before regenerating.

## Apple Watch companion

The watchOS companion is a native SwiftUI target generated during Expo prebuild by the local config plugin at `plugins/withWatchApp.js`.

Canonical native source lives outside generated iOS output:

- `native/watch/` — SwiftUI watch app source, Info.plists, and entitlements
- `native/ios/` — iPhone WatchConnectivity bridge

Generated output lives under `ios/`, including `ios/watch/`, `ios/PostHogCode/WatchTaskControlModule.*`, and `PostHogCode.xcodeproj/project.pbxproj`.

### Watch architecture

- iPhone remains the authenticated relay for the paired watch.
- Mobile derives compact task snapshots from task/session state and sends them through WatchConnectivity.
- Desktop-started local tasks work through the shared PostHog task run log/status backend, then iPhone relays to the watch.
- Watch actions send compact commands back to iPhone, which routes them through existing mobile commands (`permission_response`, `cancel`, retry/resume, and handoff URLs).
- Direct watch-to-Mac WatchConnectivity is not supported by Apple; Mac handoff uses `posthog-code://task/{taskId}/run/{taskRunId}`.

### Rebuilding native watch targets

```bash
cd apps/mobile
pnpm prebuild
# or, when regenerating native projects:
pnpm prebuild:clean
```

The `./plugins/withWatchApp` plugin copies native sources from `native/`, recreates the watch app/extension targets, and embeds them in the iOS app. If generated iOS files or Xcode targets drift, update `native/` and rerun prebuild instead of editing generated project files manually.

### Running in simulators

1. Open `ios/PostHogCode.xcworkspace` in Xcode.
2. Select the iOS app scheme with a paired iPhone + Apple Watch simulator destination.
3. Build/run the iOS app; Xcode should install the embedded watch app.
4. Sign in on iPhone and open or start a PostHog Code task.
5. Open the watch app and verify the mission overview, checklist, timeline, approvals, and blocker cards.

### Verification checklist

- Cloud task from phone/mac updates progress on watch.
- Desktop/local task shows a `Local` badge and receives progress through persisted task run logs.
- Approval card actions reach the existing permission response path.
- Stop maps to the existing cancel command; retry maps to resume/retry from iPhone.
- Open on iPhone uses `posthog://task/{taskId}`; Open on Mac uses `posthog-code://task/{taskId}/run/{taskRunId}`.
- Haptics fire once for approval needed, completion, failure/stale blockers, and action acceptance — not on every polling update.
- Intermittent connectivity shows cached mission state rather than raw errors/logs.

## Build Profiles

Defined in `eas.json`:

| Profile | Purpose | Distribution |
|---------|---------|--------------|
| `development` | Dev client with debugging | Internal only |
| `preview` | Production-like for testing | Internal only |
| `production` | App Store / Play Store release | Public |

**Local vs Cloud builds:**
- Cloud (default): Runs on Expo's servers, no local Xcode needed
- Local (`--local`): Runs on your machine, faster iteration, requires Xcode/Android SDK