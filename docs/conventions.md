# Code conventions

Detailed conventions referenced from [AGENTS.md](../AGENTS.md). Short rules live in AGENTS.md; this file expands them with examples.

## Services over hooks for business logic

Put data-fetching logic and derivation in main process services, not renderer hooks. Hooks should be thin wrappers around a single tRPC query. If a hook orchestrates multiple queries and derives a result, that logic belongs in a service exposed via tRPC so it can be reused from both the main process and the renderer.

## Small focused components

Extract distinct UI concerns into their own components instead of building long inline ternary chains or conditional blocks. If a section of JSX handles its own logic (e.g. icon selection based on state), pull it into a named component next to where it's used. Keep render functions short and scannable.

## Async cleanup ordering

When tearing down async operations that use an AbortController, always abort the controller **before** awaiting any cleanup that depends on it. Otherwise you get a deadlock: the cleanup waits for the operation to stop, but the operation won't stop until the abort signal fires.

```typescript
// WRONG - deadlocks if interrupt() waits for the operation to finish
await this.interrupt();          // hangs: waits for query to stop
this.abortController.abort();    // never reached

// RIGHT - abort first so the operation can actually stop
this.abortController.abort();    // cancels in-flight HTTP requests
await this.interrupt();          // resolves because the query was aborted
```

## Avoid barrel files

Do not make use of `index.ts`. Barrel files:

- Break tree-shaking
- Create circular dependency risks
- Hide the true source of imports
- Make refactoring harder

Import directly from source files instead.

## Zustand stores

Stores hold pure state with thin actions. Separate state and action interfaces. Use persistence middleware where needed:

```typescript
interface SidebarStoreState {
  open: boolean;
  width: number;
}

interface SidebarStoreActions {
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

type SidebarStore = SidebarStoreState & SidebarStoreActions;

export const useSidebarStore = create<SidebarStore>()(
  persist(
    (set) => ({
      open: false,
      width: 256,
      setOpen: (open) => set({ open }),
      toggle: () => set((state) => ({ open: !state.open })),
    }),
    {
      name: "sidebar-storage",
      partialize: (state) => ({ open: state.open, width: state.width }),
    }
  )
);
```

## React components

Components are functional with hooks. Props typed with interfaces:

```typescript
interface AgentMessageProps {
  content: string;
}

export function AgentMessage({ content }: AgentMessageProps) {
  return (
    <Box className="py-1 pl-3">
      <MarkdownRenderer content={content} />
    </Box>
  );
}
```

Complex components organize hooks by concern (data, UI state, side effects):

```typescript
export function TaskDetail({ task: initialTask }: TaskDetailProps) {
  const taskId = initialTask.id;
  useTaskData({ taskId, initialTask });  // Data fetching

  const workspace = useWorkspaceStore((state) => state.workspaces[taskId]);  // Store
  const [filePickerOpen, setFilePickerOpen] = useState(false);  // Local state

  useHotkeys("mod+p", () => setFilePickerOpen(true), {...});  // Effects
  useFileWatcher(effectiveRepoPath ?? null, taskId);
  // ...
}
```

## Tailwind over inline styles

Always reach for Tailwind utility classes first. The codebase uses Tailwind v4 with CSS variables from Radix Themes (e.g. `--gray-12`, `--space-3`, `--radius-2`). Use Tailwind v4's CSS-var shorthand to bridge them: `text-(--gray-12)`, `bg-(--gray-2)`, `rounded-(--radius-2)`, `border-(--gray-5)`. Use arbitrary values (`text-[13px]`, `pl-[18px]`) when the design token doesn't have a named match.

Inline `style={{}}` is acceptable in three cases only:

1. **Genuinely dynamic values** computed at runtime that can't be a class. E.g. `style={{ width: ${pxFromHook}px }}`, `style={{ transform: translateY(${y}px) }}`, pixel positions from measurement, data-driven colors that don't fit a fixed palette.
2. **Library configuration** passed to non-React libraries (CodeMirror's `EditorView.theme(...)`, xterm.js options, etc.).
3. **CSS variables set from JS** that downstream classes consume. `style={{ "--row-color": item.color }}` paired with `className="bg-(--row-color)"`.

Do NOT use inline `style` for:

- Color tokens (use `text-(--gray-12)`, `bg-(--gray-2)`, `border-(--gray-5)`)
- Spacing (use `p-3`, `mt-2`, `pl-4`, `gap-2`). Radix `--space-N` matches Tailwind's spacing scale 1:1 for `--space-1`..`--space-4`. `--space-5` = `6`, `--space-6` = `8`, etc.
- Layout primitives (`shrink-0`, `min-w-0`, `flex-1`, `overflow-y-auto`, `w-full`, `h-full`)
- Borders (`border border-(--gray-5)`), radii (`rounded-(--radius-2)` or `rounded-full`)
- Cursors (`cursor-pointer`, `cursor-col-resize`)
- Opacity (`opacity-50`), text-align, text-transform (`uppercase`), white-space, word-break
- Position (`absolute`, `relative`, `fixed`), z-index (`z-10`, `z-[201]`), inset (`inset-0`)
- Animations that map to a Tailwind utility (`animate-spin`)
- Conditional values that can be `className={cond ? "x" : "y"}` or ``className={`base-classes ${cond ? "active-classes" : "inactive-classes"}`}``

Default line-heights have been tightened in [apps/code/src/renderer/styles/globals.css](../apps/code/src/renderer/styles/globals.css). Don't add a `leading-*` class for body text unless you specifically want a non-default line-height. For arbitrary sizes (`text-[13px]`), pair with `leading-snug` for body text or `leading-tight` for titles.

When writing a custom React component that wraps a styled element, accept BOTH `className?: string` and `style?: React.CSSProperties` props and merge the `className` into the inner element's classes (e.g. ``className={`base-classes ${className ?? ""}`}``). This lets call sites override styling via Tailwind without forcing inline `style`.

## Custom hooks

Hooks extract store subscriptions or single tRPC queries into cleaner interfaces. Hooks that orchestrate multiple queries belong in a service instead:

```typescript
export function useConnectivity() {
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const check = useConnectivityStore((s) => s.check);
  return { isOnline, check };
}
```

## Learned hints

The settings store (`src/renderer/features/settings/stores/settingsStore.ts`) provides a reusable "learned hints" system for progressive feature discovery. Hints are shown a limited number of times until the user demonstrates they've learned the behavior.

```typescript
const store = useFeatureSettingsStore.getState()

// Check if a hint should still be shown (max N times, not yet learned)
if (store.shouldShowHint("my-hint-key", 3)) {
  store.recordHintShown("my-hint-key")
  toast.info("Did you know?", "You can do X with Y.")
}

// When the user demonstrates the behavior, mark it learned (stops showing)
store.markHintLearned("my-hint-key")
```

Hint state is persisted via `electronStorage`. Use this pattern instead of ad-hoc boolean flags when introducing new discoverable features.

## Logger usage

Use the scoped logger instead of `console`:

```typescript
const log = logger.scope("navigation-store");

export const useNavigationStore = create<NavigationStore>()(
  persist((set, get) => {
    log.info("Folder path is stale, redirecting...", { folderId: folder.id });
    // ...
  })
);
```

## Analytics events

Two PostHog clients emit events:

- **Renderer** (`posthog-js`) via `track(eventName, properties)` in `src/renderer/utils/analytics.ts`
- **Main** (`posthog-node`) via `trackAppEvent(eventName, properties)` in `src/main/services/posthog-analytics.ts`

Both register a super-property `team: "posthog-code"`. All event names and property types are defined in `ANALYTICS_EVENTS` and `EventPropertyMap` in `src/shared/types/analytics.ts`. Adding a new event without entries there will fail typechecking.

**Event names**

- Format: `Object verbed`. Title Case, sentence-cased, spaces between words.
- First word is the object (`Task`, `Prompt`, `Branch`, `File`).
- Second word is a past-tense verb (`created`, `viewed`, `sent`, `started`, `completed`, `failed`, `cancelled`).
- Only the first word is capitalized. Spell out abbreviations (`Pull request created`, not `PR created`).
- Group by object, not by feature. Prefer `Branch linked` over `Workspace branch linked`.
- Prefer a generic event with a discriminator property over many bespoke events. `Setting changed` with `setting_name`, not `Theme changed` plus `Font changed`.
- Do not prefix events with `First`. "First X" is always derivable in PostHog from the first occurrence of `X` per distinct ID.

Good: `Task created`, `Prompt sent`, `Setup discovery completed`, `Onboarding step completed`
Bad: `task_created`, `TaskCreated`, `created_task`, `userClickedSendButton`, `PR created`

**Property names**

- snake_case, lowercase, no leading underscore.
- Booleans: prefix with `is_`, `has_` or `can_` (`is_initial`, `has_branch`, `has_uncommitted_changes`).
- Counts: suffix with `_count` (`event_count`, `staged_file_count`).
- Durations and sizes: suffix with the unit (`duration_seconds`, `prompt_length_chars`).
- IDs: suffix with `_id` (`task_id`, `discovery_task_run_id`).
- Enums: suffix with `_type`, `_mode`, `_source`, `_kind`, `_reason`, `_action`, or the bare noun if obvious (`category`, `region`).
- Pairs: when capturing a transition, use `from_*` / `to_*` (`from_mode`, `to_mode`).

**Enum values**

- snake_case strings, lowercase (`"user_cancelled"`, `"stale_feature_flag"`).
- Never `true`/`false` as a state value. Use a meaningful enum (`"completed"` / `"cancelled"` / `"failed"`, not `success: true/false` unless it really is just success).
- Closed enums get a TypeScript union in `analytics.ts`. Open-ended values are fine when the set evolves freely (e.g. `setting_name`).

**What does not go into properties**

- No PII in event names or property values. No email addresses, full names, file paths, prompt contents, repo URLs. Hash if you need to dedupe (`path_hash`).
- No free-form strings when an enum will do.
- No giant payloads. If the value can be reconstructed from another event plus an ID, store the ID.
