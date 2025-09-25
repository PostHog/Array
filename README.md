# Mission Control

PostHog Mission Control - An engineer-first desktop app for managing tasks and automating workflows.

## Features

- 🚀 Fast, keyboard-first navigation
- 📋 Centralized task management
- 🤖 Local and cloud agent execution
- 📊 Real-time activity logs
- 🔐 Secure API key storage

## Development

### Prerequisites

- Node.js 18+
- npm or yarn

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build
```

### Environment Variables

You can set these environment variables instead of entering credentials in the app:

- `POSTHOG_API_KEY` - Your PostHog personal API key
- `POSTHOG_API_HOST` - PostHog instance URL (defaults to https://app.posthog.com)

## Architecture

- **Electron** - Desktop app framework
- **React** - UI framework
- **TypeScript** - Type safety
- **Tailwind CSS** - Styling
- **Zustand** - State management
- **Vite** - Build tool

## Project Structure

```
mission-control/
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

## License

MIT