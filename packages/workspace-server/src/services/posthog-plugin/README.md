# PosthogPluginService

Provides the PostHog plugin to agent sessions (Claude Code and Codex). The plugin is a directory containing `plugin.json` and a `skills/` folder of markdown instruction files that teach agents how to use PostHog APIs.

`AgentService` calls `getPluginPath()` when starting each session to get the path to the assembled plugin directory.

## Skills

Skills are the main content of the plugin. Each skill is a directory containing a `SKILL.md` and optional `references/` folder with supporting docs. For example, the `query-data` skill teaches agents how to write HogQL queries against PostHog's API.

Skills are published independently from PostHog Code at a stable GitHub releases URL (`skills.zip`). This service ensures agents always have the latest skills without requiring a PostHog Code update.

### Skill Sources

The plugin directory is assembled from three skill sources, merged in priority order (later overrides earlier for same-named skills):

| Source | Location | When used |
|---|---|---|
| **Shipped** | `plugins/posthog/skills/` | Always — committed to the repo |
| **Remote** | GitHub releases `skills.zip` | Downloaded at build time and every 30 min at runtime |
| **Local dev** | `plugins/posthog/local-skills/` | Dev mode only — gitignored |

A "skill name" is its directory name. If remote and shipped both have `query-data/`, the remote version wins. If local-dev also has `query-data/`, that wins over both.

## Build Time

`copyPosthogPlugin()` in `vite.main.config.mts` assembles the plugin during `writeBundle`:

1. Copies allowed plugin entries into `.vite/build/plugins/posthog/`
2. Downloads `skills.zip` via `curl`, extracts with `unzip`, overlays into the build output
3. In dev mode only: overlays `plugins/posthog/local-skills/` on top
4. Download failure is non-fatal — build continues with shipped skills only

Vite watches `plugins/posthog/` (and `local-skills/` in dev) for hot-reload.

## Runtime

`PosthogPluginService` is an InversifyJS singleton that keeps the plugin fresh in production builds where the Vite dev server isn't running.

**On startup:**
1. Creates `{userData}/plugins/posthog/` (the runtime plugin dir)
2. Assembles it: copies `plugin.json` from bundled, merges bundled skills + any previously-downloaded remote skills
3. Syncs skills to `$HOME/.agents/skills/` for Codex
4. Starts a 30-minute interval timer
5. Kicks off the first async download

**Every 30 minutes (`updateSkills`):**
1. Downloads `skills.zip` using `net.fetch` (Electron's network stack, respects proxy)
2. Extracts to a temp dir via `unzip`
3. Atomically swaps into `{userData}/skills/`
4. Re-assembles the runtime plugin dir
5. Re-syncs to Codex
6. On failure: logs a warning, keeps existing skills, retries next interval

**`getPluginPath()`** — called by `AgentService` when starting sessions:
- Dev mode → bundled path (Vite already merged everything)
- Prod → `{userData}/plugins/posthog/` (with downloaded updates)
- Fallback → bundled path

### Codex Sync

After every assembly, skills are copied to `$HOME/.agents/skills/` so that Codex sessions also pick them up.

## Dev Workflow

### Testing with local skills

1. Create a skill directory in `plugins/posthog/local-skills/`, e.g.:
   ```
   plugins/posthog/local-skills/my-skill/SKILL.md
   ```
2. Run `pnpm dev:code` — Vite watches and hot-reloads
3. The local skill overrides any shipped or remote skill with the same name

### Pulling remote skills locally for editing

```sh
pnpm pull-skills
```

Downloads the latest `skills.zip` into `plugins/posthog/local-skills/`. You can then edit them locally and Vite will pick up changes.
