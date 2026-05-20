# Analytics Event Schema

Naming conventions and the canonical catalog of PostHog events emitted by the desktop app. The authoritative type definitions live in [`src/shared/types/analytics.ts`](./src/shared/types/analytics.ts) — this doc explains the *why* and what each event means.

Two PostHog clients emit events:

- **Renderer** (`posthog-js`) via `track(eventName, properties)` in [`src/renderer/utils/analytics.ts`](./src/renderer/utils/analytics.ts).
- **Main process** (`posthog-node`) via `trackAppEvent(eventName, properties)` in [`src/main/services/posthog-analytics.ts`](./src/main/services/posthog-analytics.ts).

Both register a super-property `team: "posthog-code"` on every event. All event names and property types are defined in `ANALYTICS_EVENTS` and `EventPropertyMap` — adding a new event without entries there will fail typechecking.

---

## Naming conventions

### Event names

- **Format**: `Object verbed` — Title Case, sentence-cased, spaces between words.
- **First word is the object** (`Task`, `Prompt`, `Branch`, `File`, `Setup discovery`, `Onboarding`).
- **Second word is a past-tense verb** (`created`, `viewed`, `sent`, `started`, `completed`, `failed`, `cancelled`).
- **Only the first word is capitalized.** Spell out abbreviations (`Pull request created`, not `PR created`).
- **Group by object, not by feature.** Prefer `Branch linked` over `Workspace branch linked`.
- **Use generic events with a discriminator property over many bespoke events** when the shape is the same — e.g. `Setting changed` with `setting_name` instead of `Theme changed` + `Font changed` + ...
- **Do not prefix events with `First`** — "first X" is always derivable in PostHog from the first occurrence of `X` per distinct ID. Emit `X`, not `First X`.

✅ `Task created`, `Prompt sent`, `Setup discovery completed`, `Onboarding step completed`
❌ `task_created`, `TaskCreated`, `created_task`, `userClickedSendButton`, `PR created`

### Property names

- **snake_case**, lowercase, no leading underscore.
- **Booleans**: prefix with `is_`, `has_`, or `can_` (`is_initial`, `has_branch`, `has_uncommitted_changes`).
- **Counts**: suffix with `_count` (`event_count`, `staged_file_count`, `total_discovered`).
- **Durations / sizes**: suffix with the unit (`duration_seconds`, `entry_age_seconds`, `prompt_length_chars`).
- **IDs**: suffix with `_id` (`task_id`, `discovery_task_run_id`, `discovered_task_id`).
- **Enums**: suffix with `_type`, `_mode`, `_source`, `_kind`, `_reason`, `_action`, or use the bare noun if obvious (`category`, `region`).
- **Pairs**: when an event captures a transition, use `from_*` / `to_*` (`from_mode`, `to_mode`, `from_value`, `to_value`).

✅ `task_id`, `is_initial`, `duration_seconds`, `prompt_length_chars`, `repository_provider`
❌ `taskId`, `initial`, `duration`, `promptLength`, `repo_provider_type` (redundant suffix)

### Enum values

- **snake_case strings**, lowercase. e.g. `"user_cancelled"`, `"stale_feature_flag"`.
- **Never `true`/`false` as a state value** — use a meaningful enum (`"completed"` / `"cancelled"` / `"failed"`, not `success: true/false` unless it really is just success).
- **Open-ended values are fine** when the set evolves freely (e.g. `setting_name`, `tour_id`). Closed enums get a TypeScript union in `analytics.ts`.

### What does *not* go into properties

- **No PII** in event names or property values. No email addresses, full names, file paths, prompt contents, or repo URLs. Hash if you need to dedupe (`path_hash`).
- **No free-form strings** when an enum will do. If you find yourself writing `category: "bug" | "security" | ...`, define the union once in `analytics.ts`.
- **No giant payloads.** If the value can be reconstructed from another event + an ID, store the ID.

### Adding a new event

1. Add the constant to `ANALYTICS_EVENTS` in [`src/shared/types/analytics.ts`](./src/shared/types/analytics.ts).
2. Add the property interface (even if empty — use `never` for no-prop events).
3. Register it in `EventPropertyMap`.
4. Call `track(ANALYTICS_EVENTS.MY_EVENT, { … })` in the renderer or `trackAppEvent(...)` in main.
5. Add a row to the catalog below.

---

## Common properties

These appear across many events and should always use the same name and type when present.

| Property | Type | Meaning |
|---|---|---|
| `task_id` | `string` | The task UUID. |
| `task_run_id` | `string` | The agent run UUID inside a task. |
| `execution_type` | `"local" \| "cloud"` | Where the agent runs. |
| `adapter` | `"claude" \| "codex"` | Which agent SDK adapter is in use. |
| `repository_provider` | `"github" \| "gitlab" \| "local" \| "none"` | Source of the repo associated with the task. |
| `workspace_mode` | `"local" \| "worktree" \| "cloud"` | How files are checked out for the task. |
| `source` | enum per event | Where the action originated from (button, menu, keyboard, etc.). |
| `region` | `string` | PostHog region (`us`, `eu`, etc.). |
| `project_id` | `string` | PostHog project ID. |
| `step_id` | `string` | Onboarding step identifier — matches `ONBOARDING_STEPS`. |
| `duration_seconds` | `number` | Wall-clock duration of the action. |

---

## Event catalog

### App lifecycle (main process)

| Event | Properties |
|---|---|
| `App started` | — |
| `App quit` | — |

### Authentication

| Event | Properties |
|---|---|
| `User logged in` | `project_id?`, `region?` |
| `User logged out` | — |

### Onboarding

The first-session funnel. `step_id` ∈ `welcome`, `project-select`, `invite-code`, `github`, `install-cli` — matches the values in [`src/renderer/features/onboarding/types.ts`](./src/renderer/features/onboarding/types.ts).

| Event | Properties |
|---|---|
| `Onboarding started` | — |
| `Onboarding step viewed` | `step_id`, `step_index`, `total_steps` |
| `Onboarding step completed` | `step_id`, `step_index`, `total_steps`, `duration_seconds` |
| `Onboarding step skipped` | `step_id`, `step_index`, `reason` |
| `Onboarding sign in initiated` | `region` |
| `Onboarding project selected` | `had_multiple_orgs`, `had_multiple_projects` |
| `Onboarding invite code submitted` | `success`, `error_type?` |
| `Onboarding folder selected` | `has_git_remote`, `repository_provider` |
| `Onboarding github connected` | — |
| `Onboarding cli check completed` | `git_installed`, `gh_installed`, `gh_authenticated` |
| `Onboarding completed` | `duration_seconds`, `github_connected`, `cli_skipped` |
| `Onboarding abandoned` | `last_step_id`, `duration_seconds` |
| `Ai consent gate shown` | `is_org_admin` |
| `Ai consent approved` | — |

#### First-session funnel

```
App opened
  → Onboarding started                       (welcome screen mounts)
    → Onboarding step viewed [welcome]
    → Onboarding step completed [welcome]
      → Onboarding step viewed [project-select]
      → Onboarding sign in initiated         (clicked OAuth button)
        → User logged in
      → Onboarding project selected
      → Onboarding step completed [project-select]
        → Onboarding step viewed [invite-code]              (conditional)
        → Onboarding invite code submitted
        → Onboarding step completed [invite-code]
          → Onboarding step viewed [github]
          → Onboarding folder selected
          → Onboarding github connected      (optional)
          → Onboarding step completed [github]
            → Onboarding step viewed [install-cli]
            → Onboarding cli check completed
            → Onboarding step completed [install-cli]       (or skipped)
              → Onboarding completed
                → Ai consent gate shown      (conditional)
                → Ai consent approved        (conditional)
                  → Setup discovery started
                  → Setup discovery completed
                  → Prompt sent              (first occurrence per user = first prompt)
                  → Task created             (ACTIVATION; first occurrence = activation)
```

`Onboarding abandoned` fires when the user closes the app or logs out while inside `OnboardingFlow` (i.e. the last `Onboarding step viewed` has no matching `Onboarding step completed`).

Activation cohort: distinct ID has both `Onboarding started` and `Task created` (with `created_from: "command-menu"`) within 24h.

### Task management

| Event | Properties |
|---|---|
| `Task created` | `auto_run`, `created_from`, `repository_provider?`, `workspace_mode?`, `has_branch?`, `has_environment_setup?`, `has_sandbox_environment?`, `cloud_run_source?`, `cloud_pr_authorship_mode?`, `uses_worktree_link?`, `uses_worktree_include?`, `adapter?` |
| `Task viewed` | `task_id` |
| `Inbox viewed` | — |
| `Task run started` | `task_id`, `execution_type`, `initial_mode?`, `adapter?`, `model?` |
| `Task run cancelled` | `task_id`, `execution_type`, `duration_seconds`, `prompts_sent` |
| `Prompt sent` | `task_id`, `is_initial`, `execution_type`, `prompt_length_chars` |
| `Session config changed` | `task_id`, `category`, `from_value`, `to_value` |
| `Task feedback` | `task_id`, `task_run_id?`, `log_url?`, `event_count`, `feedback_type`, `feedback_comment?` |

### Permissions

| Event | Properties |
|---|---|
| `Permission responded` | `task_id`, `tool_name?`, `option_id?`, `option_kind?`, `custom_input?` |
| `Permission cancelled` | `task_id`, `tool_name?`, `option_id?`, `option_kind?` |

### Git / branch

| Event | Properties |
|---|---|
| `Git action executed` | `action_type`, `success`, `task_id?`, `staged_file_count?`, `unstaged_file_count?`, `commit_all?`, `staged_only?` |
| `Pull request created` | `task_id?`, `success` |
| `Agent file activity` | `task_id`, `branch_name` |
| `Branch linked` | `task_id`, `branch_name`, `source` |
| `Branch unlinked` | `task_id`, `source` |
| `Branch link default branch unknown` | `task_id`, `branch_name` |
| `Branch mismatch warning shown` | `task_id`, `linked_branch`, `current_branch`, `has_uncommitted_changes` |
| `Branch mismatch action` | `task_id`, `action`, `linked_branch`, `current_branch` |

`action_type` for `Git action executed`: `push`, `pull`, `sync`, `publish`, `commit`, `commit_push`, `create_pr`, `view_pr`, `update_pr`, `branch_here`.

### Files / diffs

| Event | Properties |
|---|---|
| `File opened` | `file_extension`, `source`, `task_id?` |
| `File diff viewed` | `file_extension`, `change_type`, `task_id?` |
| `Diff view mode changed` | `from_mode`, `to_mode` |

### Navigation

| Event | Properties |
|---|---|
| `Command menu opened` | — |
| `Command menu action` | `action_type` |
| `Command center viewed` | — |
| `Skill button triggered` | `task_id`, `button_id`, `source` |

### Settings

| Event | Properties |
|---|---|
| `Setting changed` | `setting_name`, `new_value`, `old_value?` |

Generic event — `setting_name` is the discriminator (`theme`, `terminal_font`, `desktop_notifications`, etc.).

### Tour

| Event | Properties |
|---|---|
| `Tour event` | `tour_id`, `action`, `step_id?`, `step_index?`, `total_steps?` |

`action` ∈ `started`, `step_advanced`, `dismissed`, `completed`.

### Setup discovery

| Event | Properties |
|---|---|
| `Setup discovery started` | `discovery_task_id`, `discovery_task_run_id` |
| `Setup discovery completed` | `discovery_task_id`, `discovery_task_run_id`, `task_count`, `duration_seconds`, `signal_source` |
| `Setup discovery failed` | `discovery_task_id?`, `discovery_task_run_id?`, `reason`, `error_message?` |
| `Setup task selected` | `discovered_task_id`, `category`, `position`, `total_discovered` |
| `Setup task dismissed` | `discovered_task_id`, `category`, `position`, `total_discovered` |

`category` ∈ `bug`, `security`, `dead_code`, `duplication`, `performance`, `stale_feature_flag`, `error_tracking`, `event_tracking`, `funnel`, `posthog_setup`, `experiment`.

### Billing

| Event | Properties |
|---|---|
| `Subscription started` | `plan_key`, `previous_plan_key?` |
| `Subscription cancelled` | `plan_key` |

### Inbox & prompt history

| Event | Properties |
|---|---|
| `Inbox viewed` | — |
| `Inbox interest registered` | — |
| `Prompt history opened` | `entry_count` |
| `Prompt history selected` | `entry_count`, `entry_age_seconds`, `had_pending_draft`, `had_search_query`, `prompt_length` |
