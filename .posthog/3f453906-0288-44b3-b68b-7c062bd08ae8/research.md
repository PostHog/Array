I'll help you research this task. Let me start by exploring the codebase to understand the current Electron app structure and configuration.
Let me look at the main package.json and electron forge configuration:
Now I'll consult the documentation resources you provided to understand the technical details better:
Based on my comprehensive research of the codebase, I've identified the key architectural patterns and requirements for implementing auto-updates. Let me now present the clarifying questions:
# Research Questions

Based on my analysis of the codebase, here are the key questions to guide implementation:

## Question 1: What update delivery mechanism do you want to use?

**Options:**
- a) Electron Updater with a cloud storage backend (AWS S3, Netlify, etc.) - requires you to host release files yourself. This is typical for closed-source apps and integrates well with Electron Forge's existing build pipeline.
- b) GitHub Releases as the update source - simpler setup since your repo is already on GitHub, but requires the repo to be public or uses private tokens. Good for open-source projects.
- c) Something else (please specify)

## Question 2: Where will you host the signed app builds and update metadata?

**Options:**
- a) AWS S3 bucket - requires AWS account setup, gives full control, works well with Electron Updater's S3 provider
- b) Custom HTTP server - you control the infrastructure entirely, requires maintaining your own server
- c) Netlify or similar static hosting - good for smaller files, simpler setup than S3
- c) Something else (please specify)

## Question 3: How should users be notified about available updates?

**Options:**
- a) Use the existing StatusBar component to show update progress (similar to how you display status text) - minimal UI changes, integrates with current store pattern using `statusBarStore`
- b) Create a dedicated modal/dialog component for update notifications - more prominent UX, interrupts user workflow (similar to PostHog's modal patterns you're already using)
- c) Use a notification/toast system - non-intrusive, appears in corner without blocking interaction
- c) Something else (please specify)

## Question 4: What code signing approach do you want for macOS?

**Options:**
- a) Use Apple Developer Account with code signing certificates - required for Notarization (Apple's security requirement on macOS), involves managing provisioning profiles. Your `forge.config.ts` would need `osxSign` configuration.
- b) Manual signing during CI/CD pipeline in GitHub Actions - requires storing certificates in repository secrets, more control over the process
- c) Something else (please specify)

## Question 5: How should you handle the IPC bridge for update-related events?

**Options:**
- a) Follow the existing IPC pattern you use (preload bridge exposes API to renderer, main process handles via ipcMain) - add update events like `onUpdateAvailable`, `onUpdateDownloaded` to `src/main/preload.ts` and a new `src/main/services/updater.ts`
- b) Use event emitters on the app instance directly - simpler but less isolated than your current IPC pattern
- c) Something else (please specify)