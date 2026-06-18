# MIGRATION.md — landed slice log

Running log of what moved and where. Ten lines per entry max.

For the procedure to follow when porting a new feature, see [REFACTOR.md](./REFACTOR.md).

## 2026-06-02 — task-creation orchestration → @posthog/ui (ui-task-detail COMPLETE)

- Moved: `TaskService` + `TaskCreationSaga` (the canonical renderer-service-fetching-domain-data + multi-step-orchestration forbidden pattern, ~610L) → `@posthog/ui/features/task-detail/{taskService,taskCreationSaga}`. apps task-detail feature is now fully ported.
- Registered: NEW `TASK_CREATION_PORT` (taskCreationPort.ts) aggregating workspace/folders/environment/git host I/O + getAuthenticatedClient + getTaskDirectory + getWorkspace. apps `TrpcTaskCreationPort` adapter bound in `di/container.ts`. Added `disconnectFromTask` to `sessionServiceBridge`.
- Data: orchestration (saga steps + rollback) is host-agnostic in ui; the port is dumb transport; TaskService stays a thin injectable wrapper updating ui stores.
- Cleaned: deleted apps `task-detail/service/service.ts` + `sagas/task/task-creation.ts`; repointed di/container + task-service-bridge to the ui TaskService; migrated the 490L saga test → ui (port mock replaces trpc/getSessionService vi.mocks).
- Validation: apps tsc 0; ui my-files 0; biome 0 noRestrictedImports; ui task-detail+bridge vitest 29/29 (saga 7/7); renderer `vite build` ✓ (whole app bundles). ui-task-detail → needs_validation (live create-task GUI smoke remains).

## 2026-06-02 — sidebar imperative host-I/O retired → @posthog/ui (ui-sidebar)

- Moved: `taskViewedApi` + `pinnedTasksApi` (the last imperative host helpers in apps sidebar) → `@posthog/ui/features/sidebar/taskMetaApi.ts` via module-setter `setTaskMetaApi` (parse/unpin/isPinned logic in ui; raw `trpc.workspace.*` host calls injected, wired in `desktop-services.ts`).
- Repointed: sessions/service/service.ts, archive-task-bridge, task-mutation-bridge, + 2 sessions test mocks → ui taskMetaApi. `git rm` apps useTaskViewed.ts + usePinnedTasks.ts (0 consumers).
- Data: per-task pins/timestamps truth stays host (trpc.workspace); taskMetaApi is dumb transport for non-React callers (React reads go through SIDEBAR_TASK_META_CLIENT hooks).
- Bridge: useSidebarData.ts / useTaskPrStatus.ts pure re-export shims remain (cosmetic; one is mid concurrent-delete). panels/index.ts dead barrel (0 consumers).
- Validation: apps tsc 0; ui taskMetaApi clean; biome 0 noRestrictedImports; ui sidebar vitest 41/41. GUI smoke blocked by exogenous ui-inbox InboxView build breakage. ui-sidebar → needs_validation.

## 2026-06-02 — settings feature COMPLETE → @posthog/ui (ui-settings)

- Moved: `SettingsDialog` (container), `settings/sections/SignalSourcesSettings`, `inbox/components/DataSourceSetup` (576L) → `@posthog/ui`. apps settings feature is now 100% re-export shims.
- Registered: NEW `LINEAR_INTEGRATION_CLIENT` port + `LinearIntegrationClient` iface (integrations/ports.ts); `TrpcLinearIntegrationClient` adapter bound in `desktop-services.ts` (DataSourceSetup's lone trpc call `linearIntegration.startFlow`). GitHubRepoPicker + useAuthenticatedClient were already in ui (false blockers).
- Data: settings persistence stays host (SETTINGS_*_PORT + settingsStore); SettingsDialog is pure UI reading the ported sections.
- Bridge: apps re-export shims at `@features/settings/components/SettingsDialog`, `.../sections/SignalSourcesSettings`, `@features/inbox/components/DataSourceSetup` (consumers App.tsx/MainLayout + inbox unchanged).
- Validation: apps tsc 0; ui my-files 0; biome 0 noRestrictedImports; ui inbox+settings+integrations vitest 89/89; renderer `vite build -c vite.renderer.config.mts` ✓. ui-settings → needs_validation (only live GUI smoke remains).

## 2026-06-02 — Slack settings cluster → @posthog/ui (ui-settings)

- Moved: `settings/sections/{SlackSettings,SignalSlackNotificationsSettings}` → `@posthog/ui/features/settings/sections/`. Last real settings sections except the inbox-gated SignalSources.
- Registered: NEW `SLACK_INTEGRATION_CLIENT` port + `SlackIntegrationClient` iface in `@posthog/ui/features/integrations/ports.ts` (mirrors GITHUB_INTEGRATION_CLIENT: startFlow/consumePendingCallback/onCallback/onFlowTimedOut). Ported `useSlackConnect` + `useSlackIntegrationCallback` → `@posthog/ui/features/integrations/` (off `@renderer/trpc` → useService + ui auth store). Desktop adapter `TrpcSlackIntegrationClient` bound to SLACK_INTEGRATION_CLIENT in `desktop-services.ts`.
- Data: Slack integration list/connection truth stays in the host slackIntegration router (react-query cache projection); the port is dumb transport.
- Cleaned: deleted dead apps `integrations/hooks/{useSlackConnect,useSlackIntegrationCallback}.ts` (0 consumers after the move). Inbox hooks (useSignalSourceManager/useSlackChannels) were already in ui = false blockers.
- Bridge: apps `settings/.../sections/{SlackSettings,SignalSlackNotificationsSettings}.tsx` re-export shims (consumers SettingsDialog + SignalSourcesSettings unchanged).
- Validation: ui typecheck (my files 0; exogenous task-detail/sessions red), apps typecheck 0, biome 0 noRestrictedImports, ui integrations+settings vitest 11/11, renderer `vite build -c vite.renderer.config.mts` ✓.
- Remaining ui-settings: SignalSourcesSettings + SettingsDialog gated ONLY on inbox's DataSourceSetup → ui (ui-inbox in_progress owns it).

## 2026-06-01 — editor/setup/tasks/connectivity/skill-buttons leaves → @posthog/ui

- Moved: `editor/prompt-builder` (→`@posthog/shared` for path), `setup/{buildDiscoveredTaskPrompt,categoryConfig,SetupScanFeed}`, `connectivity/connectivityToast`, `tasks/taskKeys` → `@posthog/ui`. All pure / ui-only deps.
- Dedup: `skill-buttons/prompts` apps copy (divergent near-dup, 4 live consumers) → shim re-exporting the canonical ui twin (single source of truth). Deleted dead `integrations/integrationStore` (0 refs).
- Bridge: apps re-export shims at old paths where consumers are hot (App/SessionView/SuggestedTasksPanel/SuggestedTaskCard/sessions/task-creation); cold single-consumers repointed directly.
- Validation: full typecheck 19/19; ui mcp-apps 39/39 + billing spendAnalysis 21/21; biome clean.

## 2026-06-01 — mcp-apps pure utils → @posthog/ui

- Moved: `mcp-app-theme.ts` (pure) + `mcp-app-csp.ts` (ext-apps type only) + tests → `@posthog/ui/features/mcp-apps/utils/` (alongside the already-ported host-utils).
- Bridge: none — single consumer `useAppBridge` repointed to the ui path.
- Validation: ui typecheck 0; mcp-apps/utils tests 39/39; biome clean.

## 2026-06-01 — billing spend-analysis pure layer → @posthog/ui

- Moved: `spendAnalysisFormat.ts` + `spendAnalysisPrompt.ts` (+test, 21) → `@posthog/ui/features/billing/`. Pure display/markdown helpers, no trpc/store/host coupling.
- Cleaned: spendAnalysisPrompt's type import now reads `@posthog/api-client/spend-analysis` directly (the apps `types/spend-analysis.ts` was only re-exporting that).
- Data: SpendAnalysisResponse owned by `@posthog/api-client`; these are pure projections of it.
- Bridge: none — single cold consumer `TokenSpendAnalysisBanner` repointed directly. Deferred `billing/utils.ts` (blocked on `@main` llm-gateway `UsageOutput` type).
- Validation: full typecheck 19/19; spendAnalysisPrompt 21/21; biome clean.

## 2026-06-01 — handleExternalAppAction + focusToast → @posthog/ui (external-app-action-port)

- Moved: `handleExternalAppAction` → `@posthog/ui/features/external-apps/handleExternalAppAction.ts`; `focusToast.tsx` → `@posthog/ui/features/focus/`. The recurring "hot host util" that blocked code-editor/panels/task-detail/sessions from importing it.
- Registered: `EXTERNAL_APPS_CLIENT` port extended with `openInApp`/`copyPath`; new module-level `setExternalAppsClient` (cloudFileReader pattern) for the non-React caller, wired at boot in `desktop-services` from the DI singleton.
- Data: source of truth is the desktop adapter behind `EXTERNAL_APPS_CLIENT`; toasts/auto-focus are derived effects.
- Bridge: apps `@utils/handleExternalAppAction.tsx` re-export shim (8 consumers unchanged). Retire when code-editor/panels/task-detail import the package path directly.
- Validation: full typecheck 19/19; ui external-apps 6/6 (3 new); biome clean. GUI smoke pending.

## 2026-06-01 — code-review presentational batch → @posthog/ui (ui-code-review)

- Moved: `DiffSettingsMenu`, `DiffSourceSelector`, `DraftCommentAnnotation`, `ReviewToolbar`, `constants.ts`, `hooks/useCommentState.ts` → `@posthog/ui/features/code-review` (consume only ui stores/primitives + `@pierre/diffs` + lucide).
- Registered: added `lucide-react ^1.7.0` to `@posthog/ui` deps (ReviewToolbar icons; forward-compat for remaining code-review components).
- Bridge: app re-export shims at all 6 old paths; coupled siblings (ReviewShell/ReviewPage/ReviewRows) import them via the shims unchanged.
- Note: the bulk of code-review (diff rendering + comment hooks) is blocked — it needs `trpc.git` diffs (the git-interaction cache-coherence unit) + the unported `task-detail` hub.
- Validation: ui typecheck 0 + code-review 27/27; apps web/main 0 non-exogenous; apps ReviewShell.test 4/4; biome clean.

## 2026-06-01 — resolveCloudPrUrl → @posthog/ui (ui-git-interaction)

- Moved: pure `resolveCloudPrUrl` (PR-url derivation, zero trpc) + test → `@posthog/ui/features/git-interaction/cloudPrUrl.ts` (Task ← `@posthog/shared/domain-types`, AgentSession ← ui sessionStore).
- Bridge: apps `useCloudPrUrl.ts` re-exports it; the hook stays in apps (depends on unported `useTasks`). Consumers (useCloudRunState/useTaskPrUrl) unchanged.
- Note: the rest of the git-interaction data layer is ONE coherent tRPC-react cache unit (usePrActions optimistic writes share read hooks' keys; gitCacheKeys/updateGitCache keys are shared with ChangesPanel et al.) — must move together behind GIT_INTERACTION_CLIENT, not piecemeal. See slice notes.
- Validation: ui typecheck 0; ui git-interaction 63/63; apps web touched-files clean (3 exogenous message-editor errors); biome clean.

## 2026-06-01 — PrActionType → @posthog/shared + prStatus → @posthog/ui (ui-git-interaction)

- Moved: `prActionType` enum/`PrActionType` → `@posthog/shared/git-domain` (zod-backed, barrel-exported); `git-interaction/utils/prStatus.tsx` → `@posthog/ui/features/git-interaction/utils/` (pure PR-status presentation).
- Cleaned: removes the `@main/services/git/schemas` import that previously blocked porting `prStatus`. main schemas re-export the shared type (drop-in); ws-server keeps its own enum (zod v4-vs-v3 isolation).
- Bridge: app re-export shims at `@features/git-interaction/utils/prStatus`; consumers (TaskActionsMenu/PRBadgeLink/usePrActions) unchanged.
- Validation: shared+ui+apps(main+web)+ws-server typecheck 0; ui git-interaction 56/56; biome clean.

## 2026-06-01 — agentVersion + getFilePath → @posthog/ui/utils (renderer-shared-utils)

- Moved: `agentVersion.ts`(+test) → `@posthog/ui/utils/agentVersion` (pure semver gate; added `semver`/`@types/semver` to ui); `getFilePath.ts` → `@posthog/ui/utils/getFilePath` behind `setFilePathResolver`.
- Registered: `setFilePathResolver` wired in `desktop-services` to Electron `window.electronUtils.getPathForFile` (the only host-specific bit; stays in apps).
- Bridge: app re-export shims at both `@utils/*` paths — consumers (useAgentVersion, message-editor/persistFile) unchanged.
- Validation: ui typecheck 0; apps/code web tsc 0; agentVersion 11/11; persistFile 12/12; biome clean.

## 2026-06-01 — createPr orchestration → @posthog/core/git-pr (git-pr-coupled)

- Moved: the create-PR saga orchestration `apps/code/.../git/service.ts createPr` → `GitPrService.createPr(input, host, onProgress)`. The already-ported `CreatePrSaga` is now constructed+run inside core; apps no longer imports it.
- Registered: new `CreatePrHost`/`CreatePrInput`/`CreatePrResult` in `packages/core/src/git-pr/ports.ts`; `GitPrLogger` now extends `SagaLogger`. Host ops passed per-call (no DI cycle).
- Data: source of truth is core `GitPrService`; apps `GitService.createPr` is a thin transport bridge (builds the host adapter, emits `GitServiceEvent.CreatePrProgress`).
- Bridge: apps `GitService.createPr` + git router forward unchanged; `createPrViaGh` (gh CLI = host syscall) stays host-side behind the port. Retire when renderer consumes workspace-client.
- Validation: core typecheck 0 + purity gate 0; core git-pr.test 7/7 (3 new createPr); apps main tsc 0; apps git service.test 27/27. GUI PR-creation smoke not run.

## 2026-06-01 — host-coupled utils (sounds/browser/dialog/clearStorage) → @posthog/ui

- Moved: `sounds` (+13 .mp3 assets), `browser`, `dialog`, `clearStorage` → `@posthog/ui/utils` via the module-setter pattern (`setMessageBoxHost`, `setStorageDataCleaner`, existing `openExternalUrl`/`setCloudFileReader`). `sounds` eliminated the redundant `COMPLETION_SOUND_PORT`.
- Registered: desktop-services wires the setters to trpc (`os.showMessageBox`, `folders.clearAllData`, `os.openExternal`, `fs.readFileAsBase64`).
- Bridge: app re-export shims at all `@utils/*` paths — consumers unchanged.
- Validation: ui + apps typecheck clean; notifications 12/12; biome clean.

## 2026-06-01 — renderer-shared-utils keystone batch → @posthog/ui

- Moved: `overlay`(+test), `promptContent`(+test), `urls`(+test), `posthogLinks` → `@posthog/ui/utils`; `useBlurOnEscape` → `@posthog/ui/hooks`; deleted dead `object.ts`.
- Cleaned: `urls`/`posthogLinks` read region/projectId from the ui auth store (`useAuthStore.getState()`) instead of app `getCachedAuthState` — no port needed. `overlay` (DOM) unblocked `useBlurOnEscape`.
- Bridge: app re-export shims at all old `@utils/*` / `@hooks/*` paths — consumers unchanged.
- Validation: ui + apps typecheck clean; overlay/promptContent/urls tests 23/23; biome clean.

## 2026-06-01 — cloud-artifacts + cloud-prompt → packages/ui (sessions, ~640 LOC)

- Moved: `features/sessions/utils/cloudArtifacts.ts` (409L) + `features/editor/utils/cloud-prompt.ts` (230L) → `packages/ui` (sessions/editor). Deps → `@posthog/shared`/`@posthog/api-client`/`@posthog/ui`.
- Registered: new `cloudFileReader.ts` module-level host setter (`setCloudFileReader`) wired at boot in `desktop-services.ts`; replaces the per-file `trpcClient.fs.readFileAsBase64` call.
- Bridge: app re-export shims at both old paths (sessions service / task-creation saga / useTaskCreation unchanged). cloud-prompt.test (16) moved to ui, mock repointed, node:url removed.
- Validation: ui + apps typecheck clean; cloud-prompt.test 16/16; biome clean.

## 2026-06-01 — GeneralSettings → packages/ui via SETTINGS_GENERAL_PORT (ui-settings)

- Moved: `sections/GeneralSettings` (largest settings section, 559 LOC) → `packages/ui`; sleep pref behind new `SETTINGS_GENERAL_PORT`, sound via `COMPLETION_SOUND_PORT`, `getPostHogUrl` inlined via `@posthog/shared`.
- Registered: `RendererSettingsGeneralClient` (sleep.getEnabled/setEnabled) bound in `desktop-services.ts`; app shim left.
- Validation: ui + apps/code typecheck clean for settings; biome clean; settings tests 11/11.

## 2026-06-01 — UpdatesSettings → packages/ui via SETTINGS_UPDATES_CLIENT port (ui-settings)

- Moved: `sections/UpdatesSettings` → `packages/ui/src/features/settings/sections/` behind a new `SETTINGS_UPDATES_CLIENT` port (`ports.ts`); rewrote off `@renderer/trpc` to `useService` + per-feature client.
- Registered: desktop adapter `RendererSettingsUpdatesClient` (wraps `os.getAppVersion`/`updates.check`/`updates.onStatus`) bound in `desktop-services.ts`.
- Note: confirms the per-feature client-port pattern (no generic main-trpc-react client possible — app router type can't cross into ui). Template for the remaining trpc-coupled sections.
- Validation: ui + apps/code typecheck clean for settings; biome clean.

## 2026-06-01 — settings components batch 1 → packages/ui (ui-settings)

- Moved: `SettingRow`, `SettingsOptionSelect`, `ModalInlineComboboxContent` (pure) + `sections/TerminalSettings`, `sections/PersonalizationSettings` → `packages/ui/src/features/settings/`. Imports repointed (analytics → `@posthog/ui/workbench/analytics`, `ANALYTICS_EVENTS` → `@posthog/shared`, useDebounce → ui).
- Bridge: app re-export shims at `@features/settings/components/*` keep all consumers (7 SettingRow sections, SettingsDialog, Signal* sections) unchanged.
- Cleaned: shrinks the settings feature in apps/code; SettingRow now a shared ui presentational primitive.
- Deferred: sections using `@renderer/trpc` (Updates/Permissions/Workspaces/ClaudeCode), auth/seat (Account), integrations (GitHub/Slack), host utils (General/Advanced) — all gated on a packages/ui main-trpc-react port.
- Validation: ui + apps/code typecheck clean for settings; biome clean.

## 2026-06-01 — SetupRunService orchestration → packages/ui (setup-orchestration)

- Moved: `apps/code/.../setup/services/setupRunService.ts` (656 LOC forbidden renderer orchestration) → `packages/ui/src/features/setup/setupRunService.ts` as an `@injectable()` Inversify UI service. `prompts.ts` → `packages/ui/src/features/setup/prompts.ts`.
- Registered: `SETUP_RUN_PORT` (packages/ui/.../setup/ports.ts) — host capability port (auth/task-API/agent/enrichment/env/analytics, intent-based). Service injects it + `WORKBENCH_LOGGER`; writes to the ported setupStore.
- Bridge: `apps/code/.../platform-adapters/setup-run-port.ts` (RendererSetupRunPort) wraps trpcClient + authed PostHog client + analytics + dev flag; bound in desktop-services.ts. `RENDERER_TOKENS.SetupRunService` now binds the package class.
- Data: SetupRunService owns the flow; SETUP_RUN_PORT owns host I/O; setupStore holds UI state.
- Cleaned: removes the canonical "Renderer Service Fetching Domain Data" forbidden pattern (no trpc/Electron/analytics/import.meta.env in the package).
- Validation: setupRunService.test 6 + suggestions.test 8 = 14/14; ui + apps/code typecheck clean for setup (other red exogenous); biome clean. Live discovery smoke not run.

## 2026-06-01 — ErrorBoundary → packages/ui/primitives (ui-shell leaf)

- Moved: `apps/code/.../components/ErrorBoundary.tsx` → `packages/ui/src/primitives/ErrorBoundary.tsx`, made host-agnostic (dropped `@utils/analytics`+`@utils/logger`; added `onError(error,{componentStack,suppressed})` prop).
- Bridge: `apps/code/.../components/ErrorBoundary.tsx` is now a thin wrapper supplying `onError` → `captureException` + `logger.scope`; re-exports `ErrorBoundaryProps`. Consumers (App.tsx, task-detail/TaskLogsPanel) unchanged.
- Data: telemetry/logging decision stays in the host wrapper; the primitive only signals via callback.
- Cleaned: removes apps/code analytics/logger coupling from a shared primitive.
- Validation: ui + apps/code typecheck clean for ErrorBoundary; ErrorBoundary.test 10/10 (kept in apps/code as wrapper+primitive integration test — packages/ui lacks @testing-library); biome clean.

## 2026-06-01 — setup domain logic dedup (sub-slice of ui-onboarding)

- Moved: pure enricher suggestion builders (buildStaleFlagSuggestion/buildSdkHealthSuggestion/buildPosthogSetupSuggestion + StaleFlagPayload) `apps/code/.../setup/services/setupRunService.ts` → `packages/ui/src/features/setup/suggestions.ts` (+ suggestions.test.ts, 8 tests).
- Cleaned: deleted byte-duplicate stale `apps/code/.../setup/types.ts` + `apps/code/.../setup/stores/setupStore.ts` (canonical lives in `@posthog/ui/features/setup/{types,setupStore}`; app copies had zero external consumers) — removes a duplicated-truth violation.
- Data: source of truth is `@posthog/ui/features/setup/types.ts` (DiscoveredTask + buildTaskDiscoverySchema).
- Bridge: none. Behavior-preserving; SetupRunService imports builders from the package.
- Remaining (ui-onboarding parent): SetupRunService orchestration (runDiscovery/runEnricher) still in renderer → move to core/main behind agent/enrichment/task-run/auth ports; delete onboarding stale dups.
- Validation: @posthog/ui + apps/code typecheck clean for setup (other red exogenous); suggestions.test 8/8; biome clean.

## 2026-06-01 — skills backing service + host ops → workspace-server (ui-skills #1)

- Moved: skill-listing host fs ops → `packages/workspace-server/src/services/skills/skill-discovery.ts` (findSkillDirs, getMarketplaceInstallPaths, readSkillMetadataFromDir) + `parse-skill-frontmatter.ts`; created `SkillsService.listSkills()` (`skills.ts`) injecting POSTHOG_PLUGIN_SERVICE + FOLDERS_SERVICE, with zod `schemas.ts` as boundary source of truth.
- Registered: `skillsModule` binds SKILLS_SERVICE; loaded in apps/code `container.ts` after posthogPluginModule (shares the bound plugin/folders singletons + single SQLite conn).
- Cleaned: `routers/skills.ts` collapsed to a one-line forward to SKILLS_SERVICE.listSkills() — removed the "router with no backing service + inline logic + container.get" forbidden pattern. Split `agent/discover-plugins.ts`: SDK-coupled `discoverExternalPlugins` stays in apps/code (agent slice; @anthropic-ai/claude-agent-sdk not a ws-server dep) and imports the shared helpers from ws-server. Deleted apps/code `skill-schemas.ts` + `parse-skill-frontmatter.ts`.
- Data: source of truth is ws-server `skills/schemas.ts` skillInfo zod; SkillInfo/SkillSource neutral types in @posthog/shared.
- Bridge: none new. MAIN_TOKENS.PosthogPluginService alias remains for the unrelated old posthog-plugin service.
- Validation: ws-server typecheck clean; ws-server skill-discovery.test.ts 5/5; apps/code agent discover-plugins.test.ts 21/21 (behavior preserved); biome clean. apps/code typecheck red is exogenous (concurrent MAIN_TOKENS-alias removal). UI move (SkillsView/SkillDetailPanel/skill-buttons) blocked on a packages/ui main-trpc client port + ui-code-editor/ui-task-detail/ui-shell + sessions.

## 2026-05-30 — OAuth + integrations + McpCallback + Notification retirements (6 more MAIN_TOKENS removed)

- Retired MAIN_TOKENS.OAuthService: already package-canonical (`.toService(OAUTH_SERVICE)`); repointed the 3 consumers (index bootstrap, oauth router, auth `OAuthFlowPortAdapter` @inject) to OAUTH_SERVICE, deleted bridge + token.
- Ported the integration services off `MAIN_TOKENS → .to(class)` to package-canonical identifiers: added GITHUB_INTEGRATION_SERVICE / LINEAR_INTEGRATION_SERVICE / SLACK_INTEGRATION_SERVICE to `packages/core/src/integrations/identifiers.ts`, bound the core classes to them, repointed consumers (github/linear/slack routers + index), removed the 3 tokens. No bridge needed (all consumers host-level).
- Retired MAIN_TOKENS.McpCallbackService: repointed the mcp-callback router to the existing MCP_CALLBACK_SERVICE, deleted the `.toService` bridge + token.
- Ported NotificationService to a package identifier: added NOTIFICATION_SERVICE to `packages/core/src/notification/identifiers.ts`, bound the core class to it, repointed consumers (notification router + index), removed the token.
- 15 MAIN_TOKENS service tokens retired this session. Validation: core + apps/code typecheck 0 errors; core notification test 8/8; full `pnpm typecheck` 19/19.
- Completed the integrations registration module: added `packages/core/src/integrations/integrations.module.ts` (binds GITHUB/LINEAR/SLACK_INTEGRATION_SERVICE, singleton) per REFACTOR.md "Registration Modules"; apps/code container now `container.load(integrationsModule)` + binds only the host logger ports, instead of three inline `.to(class)` binds. Lets a future web/mobile host load integrations without app-local wiring. core + my apps/code files: 0 errors.
## 2026-05-30 — host-consumer repointing + validation campaign

- Repointed the host-side consumers of the 4 remaining bridges to package identifiers: llm-gateway/cloud-task/suspension/mcp-apps routers + menu.ts (McpApps) + index.ts (Suspension) now `container.get(<PACKAGE_ID>)`. Each bridge now has exactly ONE consumer left (the off-limits tangle inject: Git/Handoff/Workspace/Agent) — annotated in container.ts so the final retirement is a one-liner.
- Validation campaign: ran package test suites. core 210 passing; ws-server pass except the better-sqlite3 DB round-trip (Electron-ABI NODE_MODULE_VERSION 145 vs 137 — environmental, not code). Promoted 16 needs_validation slices to passing with per-slice evidence: connectivity, environments, folders, archive, suspension, usage-monitor, cloud-task, enrichment, fs-capability, local-logs-capability, llm-gateway, notifications, os, github-integration, slack-integration, linear-integration.
- Authored 9 new test suites (83 tests): core llm-gateway (prompt/usage/invalidate + timeout), oauth (refreshToken status->errorCode, cancelFlow, deep-link refocus), task-link (path/run-id/queue/focus), notification (click-navigate + dock badge lifecycle), integrations github + slack (startFlow url/timeout, callback parsing incl non-numeric ids, queue/consume, timeout-cancel) + linear (authorize url + error wrap); ws-server os (showMessageBox mapping, dialog-port pickers, getClaudePermissions parse), workspace-metadata (togglePin/markViewed/markActivity-clamp + projections — annotates the in_progress workspace slice); shared backoff (getBackoffDelay exponential + cap, sleepWithBackoff timing) + regions (getCloudUrlFromRegion, getOauthClientIdFromRegion distinct-per-region, formatRegionBadge) + errors (auth/rate-limit/fatal-session classification incl rate-limit-precedence) + xml (escape/unescape round-trip). 13 suites total (~96 tests), all green; shared 277/277, core 210+, ws-server pass (modulo DB-ABI). auth slice annotated: oauth is test-backed, blocked only on agent coupling.
- Mid-turn convergence with concurrent agents: adapted oauth.test.ts to a newly-added 7th constructor param (CRYPTO_SERVICE / @posthog/platform/crypto port another agent extracted); rode out transient updates.ts / updates.test.ts churn without touching their slice.
- NOTE: src/updates/updates.test.ts has 1 red ("disabled/unsupported platform") from another agent's in-flight updates refactor (static props DISABLE_ENV_FLAG/SUPPORTED_PLATFORMS) — exogenous, not from this work; left untouched.
---

## 2026-05-29 — persistence-repositories (SQLite DB layer → workspace-server, in-process keep-sync)

- Moved: `apps/code/src/main/db/**` → `packages/workspace-server/src/db/**` (drizzle `schema`, `DatabaseService`, 8 repositories + `.mock`, `test-helpers`, migrations). New `db/identifiers.ts` (`DATABASE_SERVICE`) + `db/db.module.ts`.
- Registered: `databaseModule` bound in main `di/container.ts` (`container.load`); `DatabaseService` injects platform `STORAGE_PATHS_SERVICE`; repos inject `DATABASE_SERVICE`.
- Data: source of truth is the on-disk SQLite (`posthog-code.db`); repositories are the typed sync access layer (unchanged — kept in-process, not cross-process).
- Cleaned: dropped main logger + `MAIN_TOKENS`/`@shared` coupling from db (inlined `CloudRegion`, `SuspensionReason`, package-local `normalize-path`). Fixed apps/code `vitest.config` to reuse `rendererAliases` (`@posthog/*` workspace aliases).
- Bridge: `MAIN_TOKENS.DatabaseService` → `DATABASE_SERVICE`, and the 8 `MAIN_TOKENS.*Repository` bindings (now → package classes) remain (PORT NOTE in container.ts) so the 19 consumers are unchanged; only their db type-import paths were repointed. Build: `copy-drizzle-migrations` source + `drizzle.config` repointed to the package; runtime read path unchanged.
- Validation: `pnpm typecheck` 19/19; `pnpm --filter code test` 124 files / 1527 pass (incl. real-SQLite archive integration); `pnpm dev:code` boots clean (migrations copied, in-process DB init, live tRPC IPC, no errors). Unblocks the persistence-coupled core tier (folders/workspace/archive/suspension/handoff/agent/auth).

## 2026-05-29 — power-manager-capability (retire platform-identifiers power-manager bridge)

- Moved: auth, sleep, agent services now inject `POWER_MANAGER_SERVICE` (@posthog/platform/power-manager) instead of `MAIN_TOKENS.PowerManager`.
- Cleaned: removed the `MAIN_TOKENS.PowerManager` alias (container.ts) + token (tokens.ts) + sleep's unused MAIN_TOKENS import. ElectronPowerManager adapter unchanged (dumb onResume/preventSleep). Sleep-blocking decisions remain in SleepService.
- Validation: my files typecheck clean (unrelated git.ts errors are concurrent git-read WIP); biome clean. GUI smoke pending.

## 2026-05-29 — deep-links (partial: host-agnostic parsers → @posthog/shared)

- Moved: `decodePlanBase64` + `parseGitHubIssueUrl` (were private in `apps/code/src/main/services/new-task-link/service.ts`) → `packages/shared/src/deep-links.ts` (+ `GitHubIssueRef` type), exported from the shared barrel. new-task-link now imports them from `@posthog/shared`.
- Data: pure host-agnostic parsing utilities; no state. (Slice said `core`, but zero-dep pure utils belong in `shared`.)
- Bridge: none. Host wiring (Electron protocol registration via IAppLifecycle, IMainWindow focus, event emit/queue) intentionally stays in the apps/code link services.
- Remaining (slice in_progress): move `getDeeplinkProtocol` + `NewTaskLinkPayload`/`NewTaskSharedParams` to @posthog/shared (repoint ~10 importers); extract deep-link URL-decomposition + task/inbox path parsers.
- Validation: shared build + typecheck; `deep-links.test.ts` 8/8; apps/code typecheck clean for deep-links files.

## 2026-05-29 — dialog-capability (retire platform-identifiers dialog bridge)

- Moved: 4 main consumers (os.ts router, handoff, context-menu, folders) now inject `DIALOG_SERVICE` (@posthog/platform/dialog) instead of `MAIN_TOKENS.Dialog`.
- Cleaned: removed the `MAIN_TOKENS.Dialog` `.toService` alias (container.ts) + token (tokens.ts). ElectronDialog adapter unchanged (thin wrapper).
- Remaining: os.ts (396-line serviceless router) -> backing-service split (acceptance #2) overlaps os/misc-host-capabilities; deferred. GUI smoke (file picker + message box) pending.
- Validation: dialog edits typecheck clean (unrelated git.ts WorkspaceClient error is the concurrent git-read agent's WIP); biome clean.

## 2026-05-29 — clipboard-capability (retire platform-identifiers clipboard bridge)

- Moved: sole main consumer `external-apps/service.ts` now injects `CLIPBOARD_SERVICE` (@posthog/platform/clipboard) instead of `MAIN_TOKENS.Clipboard`.
- Cleaned: removed the `MAIN_TOKENS.Clipboard` `.toService(CLIPBOARD_SERVICE)` alias (container.ts) and the `MAIN_TOKENS.Clipboard` token (tokens.ts). ElectronClipboard adapter unchanged (already a dumb writeText wrapper).
- Note: renderer copy uses `navigator.clipboard` directly (host-appropriate DOM API), not trpcClient — no clipboard misuse to migrate. Image copy/paste path is os.ts saveClipboardImage (separate slice).
- Validation: apps/code(node) typecheck; platform-identifiers test 4/4. GUI smoke (copy text/image) pending.

## 2026-05-29 — notifications (renderer-consumed capability; gating in packages/ui, host adapter dumb)

- Moved: gating from `apps/code/src/renderer/utils/notifications.ts` -> `packages/ui/src/features/notifications/TaskNotificationService` (stopReason + focus/active-task + settings gating, title truncation). New platform contract `packages/platform/src/notifications.ts` (`INotifications`: notify/showUnreadIndicator/requestAttention, `NOTIFICATIONS_SERVICE`). New renderer adapter `apps/code/src/renderer/platform-adapters/notifications.ts` (dumb trpcClient.notification wrapper).
- Registered: `notificationsUiModule` (binds TaskNotificationService) loaded in `desktop-contributions.ts`; `NOTIFICATIONS_SERVICE` + the settings/active-view/sound UI ports bound in `desktop-services.ts`.
- Data: source of truth for "should notify" is the gating in TaskNotificationService, computed from injected facts (settings snapshot, document focus, active task id). No persisted/duplicated state.
- Bridge: `apps/code/src/renderer/utils/notifications.ts` free functions now delegate to TaskNotificationService via the renderer container (PORT NOTE). Retire when the sessions service uses `useService` directly. Main NotificationService/router/electron-notifier unchanged.
- Cleaned: platform interface is host-neutral (showUnreadIndicator/requestAttention, not dockBadge/bounceDock — adapter maps to the existing trpc procedure names).
- Validation: platform typecheck+build; apps/code web typecheck 0 errors; 12 TaskNotificationService unit tests pass. GUI smoke not yet run.

## 2026-05-29 — ui-primitives (dependency-clean leaf primitives → packages/ui/src/primitives) — in_progress (partial)

- Moved: `components/ui/{Tooltip,Button,Badge,KeyHint,PanelMessage,StepList,SafeImagePreview}`, `components/{List,Divider,DotsCircleSpinner,DotPatternBackground,CodeBlock}`, `components/ui/combobox/{Combobox,Combobox.css,useComboboxFilter}`, `hooks/{useDebounce,useDebouncedValue,useInView,useImagePanAndZoom}`, `utils/{toast,confetti}` → `packages/ui/src/primitives/**`.
- Registered: none (pure presentational primitives; no DI module). Importers across `apps/code/src` rewritten to `@posthog/ui/primitives/*` (short + `@renderer/*` + relative forms all covered).
- Data: no state; these are stateless visual/util primitives.
- Cleaned: packages/ui gained deps `@posthog/shared`, `@radix-ui/react-tooltip`, `@radix-ui/react-icons`, `cmdk`, `canvas-confetti`, `sonner` (+`@types/canvas-confetti`).
- Bridge: colocated tests/stories (CodeBlock/useDebounce/useImagePanAndZoom tests, combobox test+story) stay in apps/code pointing at `@posthog/ui` paths until packages/ui gets vitest/storybook infra.
- Deferred/not-primitives: FileIcon (host asset glob), RelativeTimestamp/action-selector/useBlurOnEscape/syntax-highlight/HighlightedCode (blocked on renderer-shared-utils + code-editor slices); HeaderRow/HedgehogMode/ZenHedgehog/focusToast/useAutoFocusOnTyping/TreeDirectoryRow are feature-coupled (belong to feature slices, not primitives).
- Validation: `pnpm typecheck` 19/19 green.

## 2026-05-29 — fs-capability (workspace-server owns fs syscalls; main is a WorkspaceClient bridge) — needs_validation

- Moved: all 8 fs methods (listRepoFiles+30s cache, readRepoFile(s), readRepoFile(s)Bounded, readAbsoluteFile, readFileAsBase64, writeRepoFile) `apps/code/src/main/services/fs/service.ts` -> `packages/workspace-server/src/services/fs/service.ts` (joins existing listDirectory). fs schemas -> `packages/workspace-server/src/services/fs/schemas.ts` (source of truth); deleted the main copies.
- Registered: 8 one-line `fs.*` procedures in `packages/workspace-server/src/trpc.ts`. Main `MAIN_TOKENS.FsService` now bound in `index.ts` via `toConstantValue(new FsService(workspaceClient))` (bridge), removed from `di/container.ts`.
- Data: source of truth is workspace-server FsService; the list cache (TTL + write-self-invalidation) lives there; renderer react-query cache is the user-facing projection (invalidated by useFileWatcher).
- Cleaned: fs no longer injects FileWatcherBridge — the watcher coupling only fed the server cache, now reconciled via TTL + renderer-side invalidation. Removes one of the 4 FileWatcherBridge-retirement consumers (remaining: archive, suspension, workspace).
- Bridge: `apps/code/src/main/services/fs/service.ts` (PORT NOTE) until AgentService reads/writes via workspace-client directly.
- Validation: ws-server typecheck + fs service.test.ts 6/6 (incl. tmp-dir round-trip + path-traversal guard); apps/code typecheck clean for all fs files. Boot smoke deferred (shared tree red from concurrent ui-primitives move).

## 2026-05-29 — connectivity (workspace-server owns polling/detection; main is status-caching bridge)

- Moved: `apps/code/src/main/services/connectivity/service.ts` polling/HTTP-reachability/backoff -> `packages/workspace-server/src/services/connectivity/{service,schemas,service.test}.ts`. New `connectivity.{getStatus,checkNow,onStatusChange}` procedures in ws `trpc.ts` (one-line forwards), bound in ws `di/{tokens,container}.ts`.
- Data: source of truth is the live network-reachability poll in the single ws-server ConnectivityService; `isOnline` is its derived state. The main bridge caches the latest value so AuthService can read it synchronously.
- Bridge: `apps/code/src/main/services/connectivity/service.ts` is now a `WorkspaceClient` bridge (extends TypedEventEmitter; subscribes to ws `onStatusChange`, re-emits `StatusChange`, answers `getStatus()` from cache). Bound in `index.ts` after `wsServer.start()`, before `initializeServices()` (AuthService consumer). Main connectivity router + renderer connectivityStore/toast unchanged.
- Bridge retirement: delete when AuthService + renderer consume `workspaceClient.connectivity` directly.
- Cleaned: dropped main-process logger from the capability; polling timer is `unref`'d; emit-on-change-only preserved.
- Validation: ws-server + apps/code(node) typecheck; 11 unit tests pass. GUI smoke not yet run.

## 2026-05-29 — local-logs (workspace-server owns fs read/coalesced write)

- Moved: `apps/code/src/main/services/local-logs/service.ts` logic → `packages/workspace-server/src/services/local-logs/{service,schemas,service.test}.ts`. New `localLogs.{read,write}` procedures in `packages/workspace-server/src/trpc.ts` (one-line forwards), bound in ws `di/{tokens,container}.ts`.
- Data: source of truth is the on-disk NDJSON at `~/.posthog-code/sessions/<taskRunId>/logs.ndjson`; the single-flight latest-wins write coalescing (per `taskRunId`) now lives in the one workspace-server instance, so all writers (renderer via `logs` router, future main callers) funnel through it.
- Bridge: `apps/code/src/main/services/local-logs/service.ts` is now a thin `LocalLogsService` over `WorkspaceClient.localLogs`, bound in `index.ts` after `wsServer.start()` (mirrors FocusService/FileWatcherBridge). `logs.ts` router and the renderer sessions service are unchanged (still `trpcClient.logs.{readLocalLogs,writeLocalLogs}`).
- Bridge retirement: delete the main bridge + `logs` router local-log procedures when the renderer sessions service consumes `workspaceClient.localLogs` directly.
- Cleaned: dropped the main-process logger dependency from the capability (ws services don't log; failures still degrade to null/no-op as before).
- Known debt: `DATA_DIR` (".posthog-code") is duplicated in the ws service, apps/code `shared/constants.ts`, and handoff `seedLocalLogs` (raw fs). Consolidate into `@posthog/shared` once the di-foundation lockfile churn settles. handoff still writes the same NDJSON via raw fs (pre-existing) — should adopt the capability later.
- Validation: ws-server + ws-client + apps/code(node) typecheck; 11 unit tests pass (vitest, ws-server root). GUI smoke (logs stream/render) not yet run.

## 2026-05-29 — di-foundation (shared DI primitives)

- Moved: `packages/ui/src/workbench/{contribution.ts,service-context.tsx}` → `packages/di/src/{contribution.ts,react.tsx}` (`git mv`). `startWorkbenchContributions` → `startWorkbench`.
- New package `@posthog/di`: owns `WORKBENCH_CONTRIBUTION` + `WorkbenchContribution` + `startWorkbench(container)`, `useService`/`ServiceProvider` (React boundary hook — see REFACTOR.md "React Access to Services": component-boundary only, never a service-locator), and a host-agnostic `WorkbenchLogger`/`WORKBENCH_LOGGER` port.
- Registered: `fileWatcherUiModule` (`ContainerModule`) binds `FileWatcherContribution` as a `WORKBENCH_CONTRIBUTION`. `apps/code` `desktop-contributions.ts` `container.load`s it; `desktop-services.ts` binds `WORKBENCH_LOGGER` to the renderer electron-log scope; `main.tsx` calls `startWorkbench(container)` before render.
- Data: source of truth is `packages/di` for the workbench DI primitives; no persisted/derived state.
- Cleaned: renderer Vite resolves `@posthog/di/*` via a new alias in `vite.shared.mts` (consistent with every other workspace package, which the repo aliases to `src/$1` rather than node_modules `exports`). `packages/ui/tsconfig.json` gained `experimentalDecorators`+`emitDecoratorMetadata` (first `@injectable` in ui; mirrors workspace-server).
- Bridge: none.
- Validation: `pnpm typecheck` (19 tasks); `@posthog/di` `startWorkbench` unit test; `pnpm --filter code test` (1588) after `build:deps`; `pnpm dev:code` boots to a rendered window with live tRPC IPC and zero resolution/boot errors.

## 2026-05-29 — platform-identifiers (package-owned DI symbols + MAIN_TOKENS bridge) — needs_validation

- Added: `export const <CAP>_SERVICE = Symbol.for("posthog.platform.<cap>")` to all 15 `packages/platform/src/*.ts` interface files. Each platform capability now owns its Inversify identifier beside its interface (no new identifiers added to `apps/code/src/main/di/tokens.ts`).
- Registered: `apps/code/src/main/di/container.ts` binds each Electron adapter to its package-owned identifier (`bind(CLIPBOARD_SERVICE).to(ElectronClipboard)`, …) and aliases the legacy `MAIN_TOKENS.<Platform>` entries via `bind(MAIN_TOKENS.Clipboard).toService(CLIPBOARD_SERVICE)`. Same singleton, single source of truth.
- Data: source of truth is the platform identifier binding; `MAIN_TOKENS.*` platform entries are projections (aliases). Interfaces audited host-neutral (no electron/macos/dock/taskbar/tray/safeStorage terms); platform imports nothing internal.
- Bridge: the 15 `MAIN_TOKENS.<Platform>` `toService` aliases remain (PORT NOTE in container.ts). Retire each once its consumers inject the `@posthog/platform` identifier directly — done per feature slice (clipboard/dialog/secure-storage/notifications/updater/power-manager/context-menu capability slices).
- Validation: `@posthog/platform` build + typecheck green; `apps/code` typecheck (node+web) green; `apps/code/src/main/di/platform-identifiers.test.ts` 4/4 (identifiers unique/namespaced; toService alias === platform singleton). Boot smoke deferred — boot path concurrently owned by in-progress di-foundation in this shared worktree.

## 2026-05-28 — file-watcher (workspace-server owns orchestration, hook is pure useSubscription)

- Moved: `apps/code/src/main/services/file-watcher/` deleted entirely. Orchestration (debounce, bulk threshold, git event filtering, git-dir resolution) lives in `packages/workspace-server/src/services/watcher/service.ts` as `WatcherService.watchRepo()`. New tRPC subscription procedure `fileWatcher.watch` emits the processed `FileWatcherEvent` discriminated union. Raw `watcher.watch` still available for unprocessed events.
- **Nothing for file-watcher lives in `packages/core/`.** The "orchestration" we thought belonged in core (debounce, bulk threshold, git filtering) turned out to be *source-smoothing* — properties of the event source, not domain logic. Source-smoothing belongs with the source. Core is for business state machines, retries, cross-feature coordination — none of which file-watcher has.
- New transport (still applies): `workspace-client` uses `splitLink` over `httpSubscriptionLink` (SSE) for subscriptions + `httpBatchLink` for queries/mutations. SSE auth via `?secret=` query param since EventSource can't send headers.
- Renderer hook (`packages/ui/src/features/file-watcher/useFileWatcher.ts`) is a 5-line `useSubscription(trpc.fileWatcher.watch.subscriptionOptions(...))` wrapper. No `useEffect`, no `for-await`, no orchestration state — pure react-query idiom. Caller passes a single `onEvent` callback and switches on `event.kind`.
- Main bridge: `apps/code/src/main/services/file-watcher/bridge.ts` is a small `FileWatcherBridge` class (~40 lines) that subscribes to `fileWatcher.watch` via workspace-client and re-emits via `TypedEventEmitter` for the four legacy in-process consumers (`fs`, `archive`, `suspension`, `workspace`). Bound at `MAIN_TOKENS.FileWatcherService` via `container.bind(...).toConstantValue(new FileWatcherBridge(workspaceClient))` in `index.ts` after `workspaceServer.start()`.
- Bridge retirement: delete `FileWatcherBridge`, its router, and the renderer's `start`/`stop` mutation calls when **fs**, **archive**, **suspension**, **workspace** migrate. Those consumers will then use `useFileWatcher` directly (renderer) or subscribe via workspace-client (background work in workspace-server or main).
- Cleaned: `WatcherRegistryService` dep dropped (its `isShutdown` check is unnecessary — subscriptions die naturally when workspace-server child or main process exits). Schemas split out of `trpc.ts` into per-service `schemas.ts`. Router is now strict one-liners.
- Left as-is: two parallel watcher pipelines per repo (the bridge + the renderer each subscribe to workspace-server); workspace-server doesn't dedupe parcel watchers. `FsService` in main still owns its file-cache invalidation. `WatcherRegistryService` still used by focus + app-lifecycle.
- New import paths: `import { useFileWatcher } from "@posthog/ui/features/file-watcher/useFileWatcher"`. For main consumers needing kind constants: `import { FileWatcherEventKind } from "@posthog/workspace-server/services/watcher/schemas"`. Bridge class: `apps/code/src/main/services/file-watcher/bridge.ts`.

---

## 2026-05-28 — api-client (transport only)

- Moved: `apps/code/src/renderer/api/{fetcher,generated,generated.augment,fetcher.test}.ts` → `packages/api-client/src/`. `generated.augment.d.ts` → `.ts` (side-effect import from `index.ts` so apps/code's tsc picks up the module augmentation through the package's exports).
- Cleaned: `__APP_VERSION__` Vite global removed from fetcher — now an `appVersion` field on `ApiFetcherConfig`. Renderer wrapper passes the global at construction.
- Left as-is: the 2929-line `posthogClient.ts` god-class. Tagged with a `PORT NOTE` — gets sliced into `packages/core/<feature>/service.ts` per feature, following REFACTOR.md "Coexistence and bridges".
- New import path: `@posthog/api-client` (was `@renderer/api/{fetcher,generated}`). Also updated `scripts/update-openapi-client.ts` to write into the new package.

---

## 2026-05-28 — focus (core owns orchestration, workspace-server owns host/git work)

- Moved host operations out of Electron main: `apps/code/src/main/services/focus/sync-service.ts` deleted; git/worktree/watch logic now lives in `packages/workspace-server/src/services/focus/{service,sync-service}.ts` behind one-line `focus.*` procedures in `packages/workspace-server/src/trpc.ts`.
- Moved orchestration out of the renderer: `apps/code/src/renderer/stores/sagas/focusSagas.ts` deleted; multi-step enable/disable/restore flow now lives in `packages/core/src/focus/service.ts` as `FocusController`, with dependencies injected as a pure interface.
- Renderer stays thin: `apps/code/src/renderer/stores/focusStore.ts` is now UI state plus one controller call per action. It adapts existing tRPC calls into the core dependency interface and no longer owns the flow graph.
- Main is a bridge, not the source of truth for focus logic: `apps/code/src/main/services/focus/service.ts` now persists the local session snapshot for Electron restarts, forwards mutations/queries to workspace-server through `WorkspaceClient`, and re-emits focus events to legacy main-router subscribers.
- Bridge retirement: delete the main `FocusService` shim and move persisted focus-session storage out of Electron once session restore/event subscribers can read directly from workspace-server (or the eventual shared persistence layer). At that point the main `focus` router can disappear with the bridge.
- Left as-is: restore still re-saves the validated session before starting workspace-server watchers so the server-side in-memory session map is repopulated after app restart. That is intentional coexistence glue, not the final architecture.

---

## 2026-05-27 — diff-stats

- Moved: `apps/code/src/main/services/git/getDiffStats` → `packages/workspace-server/src/services/git/service.ts` + `packages/ui/src/features/diff-stats/`
- New: `@posthog/workspace-server`, `@posthog/workspace-client`, `@posthog/ui` packages. Workspace-server runs as a child process spawned by Electron (`ELECTRON_RUN_AS_NODE=1`).
- Cleaned: PSK comparison now uses `timingSafeEqual`. `DiffStats` schema is the source of truth (`z.infer`), not the type. Connection query invalidates on child exit via a tRPC subscription.
- Left as-is: `useTaskDiffSummaryStats` still has 4 modes (local/branch/PR/cloud). Collapses once the relay protocol exists.
- New import paths: `useDiffStats(repoPath)` from `@posthog/ui/features/diff-stats/useDiffStats` (was `trpc.git.getDiffStats`). `DiffStatsBadge` from `@posthog/ui/features/diff-stats/DiffStatsBadge`.

## 2026-05-29 — environments (TOML CRUD -> workspace-server, UI -> packages/ui)

- Moved: `apps/code/src/main/services/environment/{service,schemas,service.test}.ts` -> `packages/workspace-server/src/services/environment/`. fs-based TOML environment CRUD is a host capability.
- Registered: ws-server `TOKENS.EnvironmentService` + `environment` tRPC router (list/get/create/update/delete, zod in/out). Added vitest to workspace-server (test script + config + smol-toml dep).
- Moved: `apps/code/src/renderer/features/environments/components/EnvironmentSelector.tsx` -> `packages/ui/src/features/environments/` + new `useEnvironments` hook (workspace-client). Cross-feature settings reach-in replaced by an `onCreateEnvironment` prop wired in TaskInput.
- Data: source of truth is the per-repo `.posthog-code/environments/*.toml` files, read/written by ws-server EnvironmentService; `Environment` zod schema is the contract. Renderer holds no env truth (react-query cache).
- Bridge: `apps/code/src/main/services/environment/service.ts` now forwards to workspace-client (binding in `index.ts`); main `environment` router + `environment/schemas.ts` remain until the settings/task-detail renderer consumers move to workspace-client.
- Deferred: `session-env/loader.ts` (agent bash env + CLAUDE_CONFIG_DIR) stays in main.
- Validation: ws-server typecheck + 21 environment tests; packages/ui typecheck; apps/code 0 new typecheck errors. App smoke pending.

## 2026-05-29 — git-read (read-only git ops -> workspace-server)

- Split: `git-core` -> `git-read` / `git-worktree` / `git-mutate` / `git-pr` sub-slices (git-core marked blocked/superseded).
- Moved: read-only git ops into `packages/workspace-server/src/services/git/` (thin wrappers over `@posthog/git/queries`) behind a one-line `git` tRPC router (zod in/out).
- Registered: `MAIN_TOKENS.WorkspaceClient` (the workspace-client bound in `index.ts` after `workspaceServer.start()`).
- Bridge: `apps/code/src/main/trpc/routers/git.ts` read procedures forward to ws-server via workspace-client. Main `GitService` retains read methods for in-process callers (WorkspaceService/HandoffService); retire with git-mutate/git-worktree + ui-git-interaction.
- Data: read git state computed by `@posthog/git/queries` in ws-server; no new persisted state. Reads are lockless; the per-repo write lock stays with git-mutate.
- Validation: ws-server typecheck; apps/code 0 new errors on git surface; env tests 21/21. App smoke pending.

## 2026-05-29 — provisioning (UI -> packages/ui, subscription -> contribution)

- Moved: `apps/code/src/renderer/features/provisioning/{stores/provisioningStore,components/ProvisioningView}` -> `packages/ui/src/features/provisioning/{store,ProvisioningView}`. Output processing (stripAnsi/processOutput) moved from the view into the store.
- Registered: `provisioningUiModule` (WORKBENCH_CONTRIBUTION -> ProvisioningContribution); `PROVISIONING_OUTPUT_PORT` host port; desktop `TrpcProvisioningOutputService` adapter bound in desktop-services; module loaded in desktop-contributions.
- Cleaned: removed component-level `useSubscription` (forbidden) — contribution subscribes once and writes the store; view is pure. Added zustand to @posthog/ui (first store in the package).
- Data: source of truth is the main ProvisioningService relay (fed by WorkspaceService.emitOutput); the ui store is a subscription-fed cache (activeTasks Set + output lines per taskId).
- Bridge: main ProvisioningService + provisioning router remain (WorkspaceService is the producer) until the workspace slice migrates.
- Validation: packages/ui typecheck; apps/code typecheck fully green; saga test 7/7. App smoke pending.

## 2026-05-29 - core-domain-types (host-neutral type ownership)
- Moved: `WorkspaceMode` -> `@posthog/shared` (`packages/shared/src/workspace.ts`); `HandoffLocalGitState` + `GitHandoffCheckpoint` (origin `@posthog/git/handoff`) -> `@posthog/shared` (`packages/shared/src/git-handoff.ts`).
- Registered: `@posthog/shared` index barrel exports `WorkspaceMode`, `HandoffLocalGitState`, `GitHandoffCheckpoint`.
- Data: source of truth for these host-neutral domain types is now `@posthog/shared`; `@posthog/git`, `@posthog/agent`, `@posthog/workspace-server`, and apps/code consume/re-export from it. `packages/core` may now import them without violating import rules (core may not import `@posthog/agent` or `@posthog/workspace-server`).
- Cleaned: removed apps/code handoff schema reach-in to ws-server db repository for `WorkspaceMode`; removed `@posthog/agent` -> `@posthog/git/handoff` dependency for the two handoff data types.
- Bridge: `@posthog/git/handoff` and `@posthog/workspace-server/.../workspace-repository` re-export the relocated types for existing consumers; retire when all consumers import from `@posthog/shared`.
- Bridge: PostHogAPIClient contract + Task/resume domain types NOT yet relocated -> tracked as slice `agent-domain-types`.
- Validation: typecheck clean across shared/git/agent/workspace-server/core/apps/code (node+web); git handoff 158/158.

## 2026-05-29 — persistence-layer (reconcile + real-SQLite round-trip test)

- Decision (recorded): domain SQLite persistence lives in `packages/workspace-server` (Node-only host capability; travels with the future cloud sandbox). The move itself landed under the `persistence-repositories` slice.
- Added: `packages/workspace-server/src/db/repositories/repositories.test.ts` — the only real-SQLite repository round-trip test (RepositoryRepository CRUD + repository→workspace→worktree FK chain), using the sanctioned `createTestDb()` + stub-DatabaseService pattern. The archive integration test mocks repositories, so this fills the genuine round-trip gap.
- Data: drizzle table schema is the single source of truth for DB row shapes (`$inferSelect`/`$inferInsert`). Repositories are in-process, not a serialization boundary — no parallel zod on repo contracts (would duplicate truth). Zod lives at the tRPC boundary in consumer feature slices.
- Bridge: `MAIN_TOKENS.*Repository` + `MAIN_TOKENS.DatabaseService` aliases remain in apps/code container.ts (PORT NOTE) until consumers inject `DATABASE_SERVICE`/package repositories directly.
- Validation: ws-server typecheck clean with the test added; no Electron imports (grep). Round-trip test EXECUTION gated on node-ABI better-sqlite3 — local snapshot has Electron-ABI (NODE_MODULE_VERSION 145) so plain-node vitest can't load it; runs green in CI / after `pnpm install`. Rebuilding locally was declined (would break the shared Electron app other agents smoke-test).

## 2026-05-29 - auth (utils sub-slice)

- Moved: `apps/code/src/renderer/features/auth/utils/userInitials.ts` -> `packages/ui/src/features/auth/userInitials.ts` (pure projection, with test)
- Registered: added vitest runner to `@posthog/ui` (vitest.config.ts + test script); first tests in the package
- Data: source of truth is the user record; `getUserInitials` is a pure derived projection (UserLike -> initials)
- Consumers: `SettingsDialog`, `AccountSettings` import from `@posthog/ui/features/auth/userInitials`
- Bridge: none (clean move; old path deleted)
- Validation: `pnpm --filter @posthog/ui test` (28 passed), `@posthog/ui typecheck` clean
- Note: `auth` slice split into auth-utils/auth-core/auth-callback-server/auth-ui; only auth-utils landed

## 2026-05-29 - agent-domain-types (Task DTO relocation, partial)
- Moved: PostHog Task DTOs (`Task`, `TaskRun`, `TaskRunArtifact`, `ArtifactType`, `TaskRunStatus`, `TaskRunEnvironment`, `PostHogAPIConfig`) `@posthog/agent/types` -> `@posthog/shared` (`packages/shared/src/task.ts`).
- Registered: `@posthog/shared` index barrel exports the Task DTOs; `@posthog/agent/types` re-exports them so all existing consumers keep working.
- Data: source of truth for the host-neutral PostHog Task model is now `@posthog/shared`; `packages/core` may import it without importing `@posthog/agent` (forbidden by import rules).
- Bridge: `@posthog/agent/types` re-export remains for existing consumers; retire when they import from `@posthog/shared`.
- Bridge: PostHogAPIClient method contract (interface in `@posthog/api-client`) + resume DATA types (`ResumeState`,`ConversationTurn`) NOT yet relocated — remain in `agent-domain-types` (needs new dep edges).
- Validation: typecheck clean across shared/agent/workspace-server/ui/core; apps/code residual errors are an unrelated concurrent process-tracking move.

## 2026-05-29 - auth (ui-state-store) + regions

- Moved: `apps/code/src/renderer/features/auth/stores/authUiStateStore.ts` -> `packages/ui/src/features/auth/authUiStateStore.ts` (thin UI store)
- Moved: `apps/code/src/shared/types/regions.ts` -> `packages/shared/src/regions.ts` (host-agnostic region types)
- Registered: `CloudRegion`/`RegionLabel`/`REGION_LABELS`/`formatRegionBadge` on the `@posthog/shared` barrel
- Data: auth form UI state (mode/invite/region) owned by the thin store; region constants are pure data in shared
- Bridge: `apps/code/src/shared/types/regions.ts` re-exports `@posthog/shared` until all 13 importers move
- Validation: ui + apps/code typecheck both 0 errors; ui tests 28 passed

## 2026-05-29 - process-tracking

- Moved: `apps/code/src/main/services/process-tracking/service.ts` -> `packages/workspace-server/src/services/process-tracking/process-tracking.ts`; `apps/code/src/main/utils/process-utils.ts` -> `packages/workspace-server/src/services/process-tracking/process-utils.ts`
- Registered: `processTrackingModule` (binds `PROCESS_TRACKING_SERVICE`); zod boundary schemas in package `schemas.ts`
- Data: source of truth is the in-memory live-PID registry owned by ProcessTrackingService (model `TrackedProcess`); `ProcessSnapshot`/`DiscoveredProcess` are derived projections
- Cleaned: dropped app-logger coupling (ws-server no-logger convention); router uses package zod schemas, inline z.enum removed
- Decision: IN-PROCESS KEEP — bound in main (not the ws-server child) so the 6 synchronous consumers (shell/agent/workspace/archive/suspension/app-lifecycle) are unchanged. Same pattern as the SQLite DB layer.
- Bridge: `MAIN_TOKENS.ProcessTrackingService` toService(`PROCESS_TRACKING_SERVICE`) in apps/code container; `apps/code/src/main/utils/process-utils.ts` re-export shim. Retire when consumers inject the package identifier; re-bind to the ws-server child when shell+agent move there.
- Validation: ws-server typecheck + 37 unit tests; `pnpm typecheck` 19/19; `pnpm --filter code test` 122 files/1474; `pnpm dev:code` clean boot

## 2026-05-29 - workspace-settings-capability
- Moved: worktree/auto-suspend settings reads off direct `settingsStore` import -> `@posthog/platform/workspace-settings` (`IWorkspaceSettings` / `WORKSPACE_SETTINGS_SERVICE`).
- Registered: `ElectronWorkspaceSettings` adapter bound to `WORKSPACE_SETTINGS_SERVICE` in `apps/code/src/main/di/container.ts`.
- Data: source of truth stays the apps/code electron-store `settingsStore`; the adapter wraps it; legacy worktree-dir default migration stays in the adapter (apps/code).
- Cleaned: `FoldersService` injects the port instead of importing `settingsStore` free functions (first consumer).
- Bridge: `settingsStore` free functions remain for the other consumers (archive, suspension, workspace, focus shim, shell, os router, worktree-helpers) until their slices migrate to the port.
- Validation: platform + apps/code (node+web) typecheck 0 errors; folders service.test.ts 23/23.

## 2026-05-29 - shared domain primitives

- Moved: `apps/code/src/shared/utils/{urls,backoff,repo}.ts` -> `packages/shared/src/*`
- Registered: `getCloudUrlFromRegion`, `getBackoffDelay`/`sleepWithBackoff`/`BackoffOptions`, `normalizeRepoKey` on the `@posthog/shared` barrel
- Data: pure host-agnostic primitives; `@posthog/shared` is now the single source
- Bridge: `apps/code/src/shared/utils/{urls,backoff,repo}.ts` re-export `@posthog/shared` until importers move
- Validation: @posthog/shared + @posthog/code typecheck both 0 errors

## 2026-05-29 — repository DI identifiers (persistence-layer cont.)

- Added: package-owned repository identifiers in `packages/workspace-server/src/db/identifiers.ts` (REPOSITORY/WORKSPACE/WORKTREE/ARCHIVE/SUSPENSION/AUTH_SESSION/AUTH_PREFERENCE/DEFAULT_ADDITIONAL_DIRECTORY) + `db/repositories.module.ts` binding each class.
- Changed: `apps/code/src/main/di/container.ts` loads `repositoriesModule`; `MAIN_TOKENS.*Repository` are now `.toService()` bridges over the package symbols (was `.to(Class)`).
- Why: the repo classes had moved to the package but their DI identifiers were still apps/code-local, so no package service could inject a repository. This unblocks folders/archive/suspension/workspace.
- Validation: full `pnpm typecheck` 19/19 green at the time of this change.

## 2026-05-29 — folders (FoldersService -> workspace-server)

- Moved: `apps/code/src/main/services/folders/{service,service.test,schemas}.ts` -> `packages/workspace-server/src/services/folders/{folders,folders.test,schemas}.ts` + new `folders.module.ts`, `identifiers.ts`, `ports.ts`.
- Registered: `foldersModule` (binds FOLDERS_SERVICE); hosted in apps/code's container (shares the single SQLite connection — not ws-server tRPC).
- Data: source of truth is the SQLite repositories (injected via package identifiers); worktree base path via `WORKSPACE_SETTINGS_SERVICE.getWorktreeLocation()` (reused the platform capability, no duplicate port). `normalizeRepoKey` inlined.
- Cleaned: router/skills repointed to package imports; `apps/code/.../folders/schemas.ts` reduced to a type-only re-export for renderer type consumers (no ws-server runtime pulled into the renderer bundle).
- Bridge: `MAIN_TOKENS.FoldersService -> FOLDERS_SERVICE`; `FOLDERS_LOGGER` bound to `logger.scope("folders-service")`. Retire MAIN_TOKENS.FoldersService once consumers inject FOLDERS_SERVICE.
- Validation: ws-server typecheck clean; `folders.test.ts` 23/23 in the new home; apps/code typecheck has zero folders-related errors (remaining apps/code/core red is exogenous: concurrent handoff/agent-types + context-menu migrations). App smoke pending (tree can't fully build while those are red).

## 2026-05-29 - misc-host-capabilities (platform alias retirements)
- Cleaned: retired 4 `MAIN_TOKENS.*` platform-alias bridges (FileIcon, AppMeta, BundledResources, ImageProcessor); 5 consumers (external-apps, agent, updates, posthog-plugin, os.ts) now inject the package-owned `@posthog/platform` symbols directly.
- Registered: removed the `.toService` aliases from `di/container.ts` and the token defs from `di/tokens.ts`.
- Bridge: `UrlLauncher`/`StoragePaths`/`MainWindow` aliases remain until their consumers migrate; os.ts still a service-less router pending carve.
- Validation: apps/code node typecheck clean in scope; behavior-preserving.

## 2026-05-29 - context-menu

- Moved: `apps/code/src/main/services/context-menu/{service,schemas,types}.ts` -> `packages/core/src/context-menu/{context-menu,schemas,types}.ts`
- Registered: `contextMenuCoreModule` (binds `CONTEXT_MENU_CONTROLLER`); new core port `CONTEXT_MENU_EXTERNAL_APPS_PORT`
- Foundation: bootstrapped core DI — added @posthog/platform + inversify + reflect-metadata to packages/core; added decorator tsconfig flags; updated core charter/description to match REFACTOR.md (host-agnostic business layer with Inversify DI over platform interfaces)
- Data: source of truth is menu content decided by the core ContextMenuService consuming platform CONTEXT_MENU_SERVICE/DIALOG_SERVICE interfaces; ElectronContextMenu adapter only renders the native menu
- Cleaned: retired MAIN_TOKENS.ContextMenu platform alias + Platform.ContextMenu token (core service injects CONTEXT_MENU_SERVICE directly); inverted external-apps coupling behind a core port
- Bridge: `CONTEXT_MENU_EXTERNAL_APPS_PORT` toService(`MAIN_TOKENS.ExternalAppsService`) until external-apps migrates to a package service
- Validation: core typecheck; `pnpm typecheck` 19/19; `pnpm --filter code test` 120/1450; `pnpm dev:code` clean boot

## 2026-05-29 — archive (ArchiveService -> workspace-server)

- Moved: `apps/code/src/main/services/archive/{service,service.integration.test,schemas}.ts` -> `packages/workspace-server/src/services/archive/{archive,archive.integration.test,schemas}.ts` + `archive.module.ts`, `identifiers.ts`, `ports.ts`.
- Registered: `archiveModule` (binds ARCHIVE_SERVICE); hosted in apps/code container (single SQLite conn, not ws-server tRPC).
- Ports: ARCHIVE_SESSION_CANCELLER (AgentService.cancelSessionsByTaskId) + ARCHIVE_FILE_WATCHER (FileWatcherBridge.stopWatching), bound via container.toDynamicValue lazy ctx.get; ARCHIVE_LOGGER -> logger.scope("archive"); worktree location via WORKSPACE_SETTINGS_SERVICE; repos via package identifiers; PROCESS_TRACKING_SERVICE.
- Data: archivedTaskSchema moved into the package; `apps/code/src/shared/types/archive.ts` -> type-only re-export (renderer type consumers unchanged, no ws-server runtime in renderer bundle).
- Bridge: `MAIN_TOKENS.ArchiveService -> ARCHIVE_SERVICE`. Retire once consumers inject ARCHIVE_SERVICE.
- Validation: ws-server typecheck clean; archive.integration.test.ts 23/23 (real git); apps/code zero archive errors (remaining red is exogenous analytics migration). App smoke pending.

## 2026-05-29 - misc-host-capabilities (os.ts service carve)
- Moved: 401-line service-less `trpc/routers/os.ts` business logic -> NEW `apps/code/src/main/services/os/service.ts` (`OsService`) + `os/schemas.ts`.
- Registered: `MAIN_TOKENS.OsService` bound to `OsService` in `di/container.ts`; `osRouter` now one-line forwards.
- Data: OsService constructor-injects DIALOG/URL_LAUNCHER/APP_META/IMAGE_PROCESSOR/WORKSPACE_SETTINGS platform capabilities; owns fs/clipboard/image host ops. Stays in apps/code main (wires Electron platform adapters).
- Cleaned: removed service-less router, inline router business logic, and business-logic container.get from the router; getWorktreeLocation now reads WORKSPACE_SETTINGS_SERVICE.
- Validation: apps/code node+web typecheck 0 errors; behavior-preserving.

## 2026-05-29 — suspension (SuspensionService -> workspace-server)

- Moved: `apps/code/src/main/services/suspension/{service,service.test,schemas}.ts` -> `packages/workspace-server/src/services/suspension/{suspension,suspension.test,schemas}.ts` + `suspension.module.ts`, `identifiers.ts`, `ports.ts`.
- Registered: `suspensionModule` (binds SUSPENSION_SERVICE); hosted in apps/code container (single SQLite conn). Ports SUSPENSION_SESSION_CANCELLER + SUSPENSION_FILE_WATCHER via toDynamicValue; SUSPENSION_LOGGER -> logger.scope("suspension"); all auto-suspend/worktree settings via WORKSPACE_SETTINGS_SERVICE; repos via package identifiers; PROCESS_TRACKING_SERVICE. Local TypedEventEmitter (no external event consumers).
- Data: suspendedTaskSchema/suspensionReasonSchema/suspensionSettingsSchema moved to the package; `apps/code/src/shared/types/suspension.ts` -> type-only re-export.
- Carve-out: sleep service (OS power) intentionally not bundled — separate concern, follow-up.
- Bridge: `MAIN_TOKENS.SuspensionService -> SUSPENSION_SERVICE`; type-imports repointed in index.ts/app-lifecycle/workspace/router.
- Validation: ws-server typecheck clean; suspension.test.ts 11/11; apps/code zero suspension errors (remaining red exogenous: @utils/path,@utils/time renderer-utils migration). App smoke pending.

## 2026-05-29 - misc-host-capabilities (MainWindow alias retirement; slice complete)
- Cleaned: retired the MainWindow MAIN_TOKENS alias; 10 consumers inject MAIN_WINDOW_SERVICE directly. With this, all 7 in-scope platform aliases (FileIcon/AppMeta/BundledResources/ImageProcessor/StoragePaths/UrlLauncher/MainWindow) are retired and os.ts is carved into OsService.
- Bridge: AppLifecycle/Updater/Notifier MAIN_TOKENS aliases remain (owned by app-lifecycle/updater/notifications slices).
- Validation: apps/code node+web typecheck 0 errors; behavior-preserving.

## 2026-05-29 — usage-schema relocation (unblocks usage-monitor)

- Moved: usageBucketSchema/usageOutput + UsageBucket/UsageOutput types from `apps/code/src/main/services/llm-gateway/schemas.ts` -> `packages/core/src/usage/schemas.ts`.
- llm-gateway/schemas.ts now value+type re-exports from `@posthog/core/usage/schemas` — llm-gateway router, usage-monitor, and the 4 renderer billing consumers are unchanged.
- Why: usage-monitor is core orchestration and core may not import apps/code; this gives the shared usage domain type a package home core can consume. (If llm-gateway later moves to ws-server, the schema can move to @posthog/shared.)
- Validation: @posthog/core typecheck clean; apps/code zero usage/llm-gateway/billing errors.

## 2026-05-29 - platform-alias bridge fully retired
- Cleaned: removed the last 3 MAIN_TOKENS platform aliases (AppLifecycle/Updater/Notifier) and the PORT NOTE bridge block. The entire MAIN_TOKENS.* -> @posthog/platform alias bridge is gone; all consumers inject package-owned platform identifiers directly.
- Validation: apps/code node+web typecheck 0 errors.

## 2026-05-29 - linear-integration (flow -> core)
- Moved: `LinearIntegrationService` + integration flow schemas `apps/code/.../linear-integration` -> `packages/core/src/integrations/{linear.ts,schemas.ts}`.
- Registered: container binds `MAIN_TOKENS.LinearIntegrationService` to the core class; router forwards.
- Bridge: `apps/code/.../integration-flow-schemas.ts` re-exports the core schemas (github/slack consume via it until they migrate).
- Validation: core integrations + apps/code node+web typecheck 0 errors.

## 2026-05-29 - typed-event-emitter (foundation)

- Moved: 3 duplicate node:events-based TypedEventEmitter copies (apps/code main util + ws-server connectivity/focus) -> ONE browser-safe impl in `packages/shared/src/typed-event-emitter.ts`
- Registered: exported `TypedEventEmitter` from the @posthog/shared barrel; added @posthog/shared dep to @posthog/workspace-server
- Data: source of truth is the single shared emitter; per-service typed event maps are projections over it
- Cleaned: removed node:events coupling from the subscription backbone so packages/core (and future web/mobile hosts) can consume it; full EventEmitter API + buffered toIterable(event,{signal})
- Bridge: `apps/code/src/main/utils/typed-event-emitter.ts` re-exports from @posthog/shared so the 24 main services + ~20 tRPC subscription routers stay unchanged — retire by repointing them to @posthog/shared
- Validation: shared unit test 13/13; pnpm typecheck 19/19; apps/code tests 1395; pnpm dev:code full boot with live subscription layer, zero emitter errors

## 2026-05-29 - DEEP_LINK platform port
- Added: `@posthog/platform/deep-link` (`IDeepLinkRegistry` / `DEEP_LINK_SERVICE` / `DeepLinkHandler`). `DeepLinkService` implements it; 7 feature consumers inject the port instead of the concrete service.
- Data: deep-link handler registry is now a host-neutral port; apps/code provides the impl; host-boot protocol registration + URL dispatch stay on the concrete service.
- Validation: apps/code node+web typecheck 0 errors.

## 2026-05-29 — usage-monitor (UsageMonitorService -> core)

- Moved: `apps/code/src/main/services/usage-monitor/{service,service.test,schemas}.ts` -> `packages/core/src/usage/{usage-monitor,usage-monitor.test,monitor-schemas}.ts` + schemas.ts (usage types), ports.ts, identifiers.ts, usage-monitor.module.ts.
- Registered: `usageMonitorModule` (binds USAGE_MONITOR_SERVICE); hosted in apps/code container. Ports: USAGE_GATEWAY (LlmGatewayService.fetchUsage), USAGE_ACTIVITY_MONITOR (AgentService LlmActivity + hasActiveSessions) via toDynamicValue; USAGE_THRESHOLD_STORE + USAGE_LOGGER via toConstantValue. Local TypedEventEmitter (router subscriptions over toIterable).
- Data: usage schema (usageBucketSchema/usageOutput) lives in @posthog/core/usage/schemas; llm-gateway/schemas.ts re-exports. usage-monitor/store.ts (electron-store) retained in apps/code, wrapped by the THRESHOLD_STORE adapter.
- Bridge: `MAIN_TOKENS.UsageMonitorService -> USAGE_MONITOR_SERVICE`; router repointed to core.
- Validation: full `pnpm typecheck` 19/19 green; usage-monitor.test 12/12 in core.

## 2026-05-30 - github + slack integration services -> core
- Moved: `GitHubIntegrationService` + `SlackIntegrationService` -> `packages/core/src/integrations/{github.ts,slack.ts}` (+ `identifiers.ts` with `IntegrationLogger` and per-provider logger tokens).
- Registered: container binds `MAIN_TOKENS.{GitHub,Slack}IntegrationService` to the core classes and the `*_INTEGRATION_LOGGER` tokens to `logger.scope(...)`; routers/index repoint to core.
- Data: services inject DEEP_LINK/URL_LAUNCHER/MAIN_WINDOW platform ports + an injected logger; flow schemas + region utils + TypedEventEmitter from core/shared. All 3 integration services (linear/github/slack) now in `packages/core`.
- Bridge: apps/code `integration-flow-schemas.ts` still re-exports core schemas; shared `features/integrations` UI not yet moved to packages/ui.
- Validation: apps/code node+web typecheck 0 errors.

## 2026-05-29 - updater (core orchestration)

- Moved: apps/code/src/main/services/updates/{service,schemas,test}.ts -> packages/core/src/updates/{updates,schemas,updates.test}.ts
- Registered: updatesCoreModule (UPDATES_SERVICE); new UPDATE_LIFECYCLE_PORT + UPDATES_LOGGER
- Data: source of truth is the UpdatesService state machine (idle/checking/downloading/ready/installing/error) over platform UPDATER/APP_LIFECYCLE/APP_META/MAIN_WINDOW interfaces; updateStore is a subscription projection
- Cleaned: extends @posthog/shared TypedEventEmitter (no node:events); inverted the update-quit handoff behind UPDATE_LIFECYCLE_PORT; logger via injected SagaLogger; isDevBuild->appMeta.isProduction; added vitest to packages/core
- Bridge: MAIN_TOKENS.UpdatesService toService(UPDATES_SERVICE) + UPDATE_LIFECYCLE_PORT toService(MAIN_TOKENS.AppLifecycleService) until menu/index/router migrate
- Validation: core tests 66; pnpm typecheck 19/19; apps/code tests 1329; dev:code boot clean

## 2026-05-29 - auth-core (AuthService -> packages/core)

- Moved: `apps/code/src/main/services/auth/service.ts` (AuthService) -> `packages/core/src/auth/auth.ts`
- Registered: AUTH_PREFERENCE/SESSION/OAUTH_FLOW/CONNECTIVITY/TOKEN_CIPHER ports (packages/core/src/auth/ports.ts); auth.module.ts; WORKBENCH_LOGGER bound in main
- Data: AuthService owns session/refresh truth; ws-server drizzle rows mapped to core domain records (AuthSessionRecord/AuthPreferenceRecord) in desktop adapters
- Cleaned: removed the forbidden ws-server/electron coupling from the auth business logic; OAuth host flow behind OAUTH_FLOW_PORT (OAuthService stays the Electron adapter)
- Bridge: `apps/code/src/main/services/auth/service.ts` re-exports `@posthog/core/auth/auth` until consumers import it directly
- Validation: full typecheck 19/19; apps/code 1292 tests; core auth 18 tests

## 2026-05-29 — enrichment (EnrichmentService -> core)

- Moved: `apps/code/src/main/services/enrichment/{service,detectPosthogInstallState.test,findStaleFlagSuggestions.test}.ts` -> `packages/core/src/enrichment/{enrichment,detectPosthogInstallState.test,findStaleFlagSuggestions.test}.ts` + ports.ts, identifiers.ts, enrichment.module.ts.
- Registered: `enrichmentModule` (binds ENRICHMENT_SERVICE); hosted in apps/code container. Ports: ENRICHMENT_AUTH (AuthService), ENRICHMENT_FILE_READER (node fs + @posthog/git listFilesContainingText), ENRICHMENT_LOGGER. core consumes @posthog/enricher directly (added to core deps; @posthog/git devDep for tests).
- Cleaned: core stays fs/git-free behind the file-reader port; auth behind a minimal port shape.
- Bridge: `MAIN_TOKENS.EnrichmentService -> ENRICHMENT_SERVICE`; router repointed to @posthog/core/enrichment.
- Validation: core typecheck clean; 19/19 enrichment tests in core (real git + tree-sitter + fetch mocks); apps/code zero enrichment errors.

## 2026-05-30 - task/inbox/new-task link services -> core
- Moved: `TaskLinkService`/`InboxLinkService`/`NewTaskLinkService` -> `packages/core/src/links/*` (+ `identifiers.ts` LinkLogger + per-service logger tokens). Tests moved too (39 pass).
- Registered: container binds `MAIN_TOKENS.{Task,Inbox,NewTask}LinkService` to the core classes + the logger tokens to `logger.scope(...)`; index/deep-link-router/notification repoint to core.
- Data: services inject DEEP_LINK + MAIN_WINDOW platform ports + injected logger; TypedEventEmitter + deep-link utils from shared. No AuthService coupling.
- Validation: core links 39 tests; apps/code node+web 0 errors.

## 2026-05-29 — mcp-apps (McpAppsService -> core)

- Moved: `apps/code/src/main/services/mcp-apps/service.ts` -> `packages/core/src/mcp-apps/mcp-apps.ts`; `apps/code/src/shared/types/mcp-apps.ts` -> `packages/core/src/mcp-apps/schemas.ts` (+ identifiers.ts, ports.ts, mcp-apps.module.ts).
- Registered: `mcpAppsModule` (binds MCP_APPS_SERVICE); hosted in apps/code container. Injects URL_LAUNCHER_SERVICE + MCP_APPS_LOGGER; local TypedEventEmitter. Added @modelcontextprotocol/sdk + ext-apps to core deps.
- Cleaned: apps/code @shared/types/mcp-apps -> `export *` re-export from core (renderer + router unchanged); menu.ts + agent type-imports repointed.
- Bridge: `MAIN_TOKENS.McpAppsService -> MCP_APPS_SERVICE`.
- Validation: core typecheck clean; apps/code zero mcp errors (remaining red exogenous: posthog-plugin migration). App smoke pending.

## 2026-05-29 - posthog-plugin (workspace-server capability)

- Moved: apps/code/src/main/services/posthog-plugin/* + utils/extract-zip.ts -> packages/workspace-server/src/services/posthog-plugin/*
- Registered: posthogPluginModule (POSTHOG_PLUGIN_SERVICE); POSTHOG_PLUGIN_LOGGER; added fflate dep
- Data: source of truth is the runtime plugin/skills dirs under appDataPath; PosthogPluginService orchestrates download+overlay+codex-sync via UpdateSkillsSaga
- Cleaned: extends @posthog/shared TypedEventEmitter; captureException via platform ANALYTICS_SERVICE; isDevBuild->appMeta.isProduction; logger via injected SagaLogger
- Bridge: MAIN_TOKENS.PosthogPluginService toService(POSTHOG_PLUGIN_SERVICE) until index/skills/agent inject directly
- Validation: ws-server typecheck + 27 tests; apps/code+core typecheck 0; dev:code boot 'Saga completed successfully'

## 2026-05-29 — external-apps (ExternalAppsService -> workspace-server)

- Moved: `apps/code/src/main/services/external-apps/{service,schemas,types}.ts` -> `packages/workspace-server/src/services/external-apps/{external-apps,schemas,types}.ts` + identifiers.ts, ports.ts, external-apps.module.ts.
- Registered: `externalAppsModule` (binds EXTERNAL_APPS_SERVICE); hosted in apps/code container. Injects CLIPBOARD_SERVICE + FILE_ICON_SERVICE + EXTERNAL_APPS_STORE port (electron-store bound in apps/code). Dropped getPrefsStore() (unused) + STORAGE_PATHS (only fed the store). DetectedApplication/ExternalAppType from ./schemas (no @shared barrel dep).
- Bridge: `MAIN_TOKENS.ExternalAppsService -> EXTERNAL_APPS_SERVICE` (CONTEXT_MENU_EXTERNAL_APPS_PORT resolves through it); router + index.ts repointed.
- Validation: full `pnpm typecheck` 19/19 green.

## 2026-05-29 — llm-gateway (LlmGatewayService -> core)

- Moved: `apps/code/src/main/services/llm-gateway/{service,schemas}.ts` -> `packages/core/src/llm-gateway/{llm-gateway,schemas}.ts` + ports.ts, identifiers.ts, llm-gateway.module.ts.
- Registered: `llmGatewayModule`; hosted in apps/code container. Ports keep core @posthog/agent-free: LLM_GATEWAY_AUTH (AuthService getValidAccessToken+authenticatedFetch), LLM_GATEWAY_ENDPOINTS (apps/code supplies @posthog/agent URL helpers + DEFAULT_GATEWAY_MODEL), LLM_GATEWAY_LOGGER.
- Cleaned: apps/code llm-gateway/schemas.ts -> `export *` re-export from core (renderer billing type consumers unchanged); git/service + router repointed.
- Bridge: `MAIN_TOKENS.LlmGatewayService -> LLM_GATEWAY_SERVICE`.
- Validation: core typecheck clean; apps/code zero llm-gateway errors (remaining red exogenous: GitFileStatus shared migration).

## 2026-05-29 — auth-callback-server (dev OAuth HTTP server -> workspace-server)

- Moved: the dev HTTP callback server from `apps/code/src/main/services/oauth/service.ts` -> `packages/workspace-server/src/services/oauth-callback/oauth-callback.ts` (OAuthCallbackServer.waitForCode owns http.Server/listen/connections/timeout/HTML; cancel via AbortSignal).
- Registered: `oauthCallbackModule` (binds OAUTH_CALLBACK_SERVER); loaded in apps/code container.
- Refactored: OAuthService (stays in apps/code) injects OAUTH_CALLBACK_SERVER; waitForHttpCallback delegates; pendingFlow uses an AbortController; getCallbackHtml/cleanupHttpServer/node:http removed. Deep-link prod path + PKCE + token exchange unchanged.
- Validation: full `pnpm typecheck` 19/19 green.

## 2026-05-29 — mcp-callback (dev MCP-OAuth HTTP server -> workspace-server)

- Moved: dev HTTP callback server from `apps/code/src/main/services/mcp-callback/service.ts` -> `packages/workspace-server/src/services/mcp-callback/mcp-callback-server.ts` (McpCallbackServer.waitForCallback -> URLSearchParams; owns http.Server/timeout/connections/HTML; cancel via AbortSignal; `successWhen` predicate picks success/error HTML).
- Registered: `mcpCallbackModule` (MCP_CALLBACK_SERVER); loaded in apps/code container.
- Refactored: McpCallbackService (apps/code) injects MCP_CALLBACK_SERVER, delegates; pendingCallback uses AbortController; getCallbackHtml/cleanupHttpServer/node:http removed. Deep-link prod path + events unchanged.
- Validation: full `pnpm typecheck` 19/19 green. Same pattern as auth-callback-server.

## 2026-05-29 — os (OsService -> workspace-server)

- Moved: `apps/code/src/main/services/os/{service,schemas}.ts` -> `packages/workspace-server/src/services/os/{os,schemas}.ts` + identifiers, os.module.ts.
- Registered: `osModule` (OS_SERVICE); hosted in apps/code container. Injects only platform services (DIALOG/URL_LAUNCHER/APP_META/IMAGE_PROCESSOR/WORKSPACE_SETTINGS) + node fs/os/path + @posthog/shared image utils.
- Bridge: `MAIN_TOKENS.OsService -> OS_SERVICE`; os router repointed (service + schemas).
- Validation: full `pnpm typecheck` 19/19 green.

## 2026-05-29 — cloud-task (CloudTaskService -> core)

- Moved: `apps/code/src/main/services/cloud-task/*` -> `packages/core/src/cloud-task/{cloud-task,schemas,cloud-task-types,sse-parser}.ts` + ports/identifiers/module + tests.
- Registered: `cloudTaskModule`; hosted in apps/code container. CLOUD_TASK_AUTH port (AuthService.authenticatedFetch) + CLOUD_TASK_LOGGER. @posthog/shared TypedEventEmitter + StoredLogEntry/TaskRunStatus. SseEventParser logger decoupled (onWarn callback).
- Data: CloudTask* update types kept as a core copy (cloud-task-types.ts) pending the concurrent shared-domain-types relocation landing in the @posthog/shared index barrel.
- Bridge: `MAIN_TOKENS.CloudTaskService -> CLOUD_TASK_SERVICE`; router + handoff repointed.
- Validation: full `pnpm typecheck` 19/19 green; cloud-task.test 22/22 + sse-parser 3/3 in core.

## 2026-05-29 — shell (ShellService -> workspace-server)

- Moved: `apps/code/src/main/services/shell/{service,schemas}.ts` -> `packages/workspace-server/src/services/shell/{shell,schemas}.ts` + identifiers/ports/module. pty = ws-server host concern.
- Registered: `shellModule` (SHELL_SERVICE); hosted in apps/code container. Injects PROCESS_TRACKING + repos + WORKSPACE_SETTINGS (inlined deriveWorktreePath) + SHELL_LOGGER. @posthog/shared TypedEventEmitter + ws-server buildWorkspaceEnv. Added node-pty to ws-server deps.
- Bridge: `MAIN_TOKENS.ShellService -> SHELL_SERVICE`; shell + agent routers repointed.
- Validation: ws-server + core + apps/code typecheck clean (ui red is exogenous).

## 2026-05-29 — ui-service (UIService -> core)

- Moved: `apps/code/src/main/services/ui/{service,schemas}.ts` -> `packages/core/src/ui/{ui,schemas}.ts` + identifiers/ports/module. UI command event relay (menu->renderer) over @posthog/shared TypedEventEmitter; UI_AUTH port (test-only token invalidation).
- Bridge: `MAIN_TOKENS.UIService -> UI_SERVICE`; menu.ts + ui router repointed.
- Validation: full `pnpm typecheck` 19/19 green.

## 2026-05-29 — oauth (OAuthService -> core)

- Moved: `apps/code/src/main/services/oauth/{service,schemas}.ts` -> `packages/core/src/oauth/{oauth,schemas}.ts` + identifiers/ports/module. PKCE flow orchestration.
- Registered: `oauthModule`; hosted in apps/code container. Platform deps (DEEP_LINK/URL_LAUNCHER/MAIN_WINDOW) + OAUTH_CALLBACK port (-> ws-server OAuthCallbackServer) + OAUTH_ENV {isDev} + OAUTH_LOGGER. oauth constants/backoff/urls from @posthog/shared.
- Bridge: `MAIN_TOKENS.OAuthService -> OAUTH_SERVICE`; router/index/port-adapters repointed.
- Validation: full `pnpm typecheck` 19/19 green.

## 2026-05-29 — bridge retirements (6 temporary MAIN_TOKENS bridges removed)

- Retired MAIN_TOKENS.{OsService, FoldersService, ArchiveService, UsageMonitorService, EnrichmentService, UIService} — consumers (routers + menu.ts) now inject the package identifiers (OS_SERVICE, FOLDERS_SERVICE, ARCHIVE_SERVICE, USAGE_MONITOR_SERVICE, ENRICHMENT_SERVICE, UI_SERVICE) directly; the `.toService` bridges + MAIN_TOKENS tokens deleted. The documented final migration step for these ported services.
- Remaining MAIN_TOKENS service bridges (LlmGateway, CloudTask, Suspension, McpApps) stay until their cross-service injectors in the agent/workspace/handoff tangle migrate.
- Validation: full `pnpm typecheck` 19/19 green.

## 2026-05-29 — bridge retirements (3 more: Shell, AuthProxy, McpProxy)

- Retired MAIN_TOKENS.{ShellService, AuthProxyService, McpProxyService}. Consumers were routers/adapters, NOT the tangle classes: shell + agent routers (container.get) -> SHELL_SERVICE; agent/auth-adapter (@inject) -> AUTH_PROXY_SERVICE + MCP_PROXY_SERVICE. `.toService` bridges + MAIN_TOKENS tokens deleted; *_AUTH/*_LOGGER port bindings + ws-server modules kept.
- 9 bridges retired total this session. Validation: apps/code typecheck clean.

## 2026-05-29 — DECISION: do not import @posthog/agent into core

- handoff/AgentService are blocked on @posthog/agent coupling (runtime resumeFromLog + agent type signatures). DECISION: do NOT make @posthog/agent a core dependency (would break core's host-agnostic web/mobile purpose; the SDK is Node/process-coupled), and do NOT touch the @posthog/agent package now.
- Consequence: handoff + AgentService stay in apps/code (desktop host services, not core slices) until a later agent-package split extracts pure types/utils to @posthog/shared and injects the runtime via ports.

## 2026-05-30 - terminal feature -> packages/ui (complete)
- Moved: `apps/code/src/renderer/features/terminal/*` (TerminalManager 514LOC, terminalStore, resolveTerminalFontFamily, Terminal/ShellTerminal/ActionTerminal components) -> `packages/ui/features/terminal/`.
- Registered: `ShellClient` port (`packages/ui/features/terminal/shellClient.ts`, incl. onData/onExit subscription methods) + apps/code `shellClientAdapter` wrapping trpcClient.shell.* + os.openExternal, registered at boot in main.tsx.
- Cleaned: components now subscribe via the imperative port in useEffect (no trpcReact); service/store use getShellClient(); logger/platform via @posthog/ui ports; xterm added to ui deps.
- Bridge: none — fully ported. Shell output subscriptions flow through the ShellClient port.
- Validation: apps web 0, node 0; ui terminal test 7/7; full ui sweep 157.

## 2026-05-30 - sessions store/hook/util layer -> packages/ui
- Moved: @utils/{session,promptContent}, features/sessions/{hooks/useSession,stores/sessionStore} -> packages/ui/features/sessions/* (path/session-events types via @posthog/shared; PermissionRequest/UserMessageAttachment via ui session types; ACP via ui dep).
- Cleaned: removed apps/code @utils/session + @utils/promptContent + the sessions hooks/stores dirs. sessionStore was unblocked by relocating its util chain bottom-up.
- Bridge: sessions COMPONENTS (SessionView etc.) remain in apps/code (trpcReact); convert via the imperative-port + useEffect pattern next.
- Validation: apps web 0, node 0; ui 186 tests.

## 2026-06-01 — git-mutate (pure git-CLI mutations → workspace-server)
- Moved: branch create/checkout, stage/unstage, discard, sync-status (+fetch throttle = source smoothing), push/pull/publish/sync + a mutate-variant getStateSnapshot from `apps/code/src/main/services/git/service.ts` into `packages/workspace-server/src/services/git/service.ts`. Added the matching zod schemas to the package `schemas.ts`.
- Registered: 11 one-line `git.*` procedures in `packages/workspace-server/src/trpc.ts`. Main `git` router procedures now FORWARD to ws-server via `WorkspaceClient` (extends the git-read PORT NOTE). Main `GitService` keeps the methods for in-process callers (WorkspaceService/HandoffService/createPr).
- Data: source of truth for these ops is `@posthog/git` (sagas/queries) running in the ws-server child; GitStateSnapshot is a derived aggregate (changedFiles+diffStats+syncStatus+latestCommit). PR status excluded from the mutate snapshot (never requested by this group).
- Deferred: `commit` (needs AgentService session-env — main process), `cloneRepository`+`onCloneProgress` (progress streaming). All gh/PR ops → git-pr.
- Bridge retirement: delete the main forwarding when renderer git-interaction consumes `workspaceClient.git.*` directly (ui-git-interaction slice).
- Validation: ws-server typecheck clean; apps/code git router/service 0 errors (remaining apps/code red exogenous); ws-server tests 243/248 (5 = known better-sqlite3 Electron-ABI DB test). App smoke pending.

## 2026-06-01 — workspace (WorkspaceService -> workspace-server)

- Moved: `apps/code/src/main/services/workspace/service.ts` -> `packages/workspace-server/src/services/workspace/workspace.ts`; `schemas.ts` -> same package dir. `apps/code/.../workspace/schemas.ts` is now a re-export shim (14 renderer `import type` consumers + workspace router). Deleted dead duplicate `workspaceEnv.ts` (canonical: `packages/workspace-server/src/workspace-env.ts`).
- Registered: `workspaceModule` (binds `WORKSPACE_SERVICE`); ports.ts + identifiers.ts. Full constructor injection.
- Data: source of truth is the WORKSPACE/WORKTREE/REPOSITORY repos (ws-server); derived projections are Workspace/WorkspaceInfo/WorktreeInfo computed per call (git branch via repo-fs-query), activeRepoStore (UI), workspace UI.
- Cleaned: removed the last `MAIN_TOKENS` property-injection in WorkspaceService. Cross-layer deps now narrow ports: `WORKSPACE_AGENT` (cancelSessionsByTaskId + onAgentFileActivity), `WORKSPACE_FILE_WATCHER` (stopWatching + onGitStateChanged), `WORKSPACE_FOCUS` (onBranchRenamed), `WORKSPACE_PROVISIONING` (emitOutput), `WORKSPACE_LOGGER`; settings via WORKSPACE_SETTINGS_SERVICE, analytics via ANALYTICS_SERVICE. ws-server never imports core (provisioning is a port) or apps/code.
- Bridge: `MAIN_TOKENS.WorkspaceService -> WORKSPACE_SERVICE` (toService) for the workspace router + GitService + index.ts initBranchWatcher. Retire once those inject WORKSPACE_SERVICE. schemas shim retires when renderer workspace types move to @posthog/shared / workspace-client.
- Validation: ws-server typecheck clean; `biome lint packages/workspace-server/src/services/workspace` 0 noRestrictedImports; new `workspace.test.ts` 7/7. apps/code typecheck has 0 workspace-attributable errors.

## 2026-06-01 - agent (AgentService -> workspace-server)
- Moved: `apps/code/src/main/services/agent/{service.ts,auth-adapter.ts,discover-plugins.ts,schemas.ts}` -> `packages/workspace-server/src/services/agent/{agent.ts,auth-adapter.ts,discover-plugins.ts,schemas.ts}`
- Registered: `agentModule` (binds `AGENT_SERVICE`, `AGENT_AUTH_ADAPTER`); 5 inversion ports (`AGENT_SLEEP_COORDINATOR`, `AGENT_MCP_APPS`, `AGENT_REPO_FILES`, `AGENT_AUTH`, `AGENT_LOGGER`) bound in apps/code container
- Data: source of truth is `packages/agent` framework; ws-server `AgentService` owns session lifecycle; projection = session messages in sessions UI
- Cleaned: agent SDK host integration now lives in a package, not apps/code; core/host deps inverted into narrow ports (no more direct McpApps/Sleep/Auth/Fs coupling in the moved service); ws-server moved to zod v4
- Bridge: `MAIN_TOKENS.AgentService` + `MAIN_TOKENS.AgentAuthAdapter` (`toService` aliases) remain until handoff/git/router/usage-monitor inject `AGENT_SERVICE` directly
- Validation: `@posthog/workspace-server typecheck` 0; agent unit tests 44/44; `biome lint` agent dir 0 noRestrictedImports. Live-app smoke deferred (concurrent MAIN_TOKENS slice breaks apps/code build)

## 2026-06-01 — git-pr (pure gh-CLI PR/GitHub ops → workspace-server)
- Moved 18 pure gh-CLI methods (gh status/auth, PR status/url/open/details, PR+branch file diffs + toUnifiedDiffPatch, review comments + resolve/reply/update, PR template, commit conventions, GitHub ref search/issue/PR) from `apps/code/src/main/services/git/service.ts` into `packages/workspace-server/src/services/git/service.ts`, with matching zod schemas. 18 one-line `git.*` procedures in ws `trpc.ts`; main `git` router procedures forward via `WorkspaceClient` (extends the git-read/git-mutate PORT NOTE). Main GitService keeps the methods for in-process callers (createPr).
- Data: source of truth is the `gh` CLI / `@posthog/git` running in the ws-server child; no new persisted state. Dropped the module logger from moved error paths (degrade to null/[] as before).
- Deferred (coupled to main-process services, cannot run in the ws-server child): getTaskPrStatus (WorkspaceService), createPr/createPrViaGh (AgentService session-env + WorkspaceService linkBranch + commit), generateCommitMessage/generatePrTitleAndBody (LlmGateway.prompt) — need GIT_WORKSPACE_PORT/GIT_AGENT_ENV_PORT/GIT_LLM_PORT (git-pr-coupled follow-up).
- Bridge retirement: delete the main forwarding when renderer git-interaction consumes `workspaceClient.git.*` directly (ui-git-interaction slice).
- Validation: ws-server typecheck GREEN; apps/code git router/service 0 errors; biome clean; ws-server tests 294/299 (5 = known better-sqlite3 Electron-ABI DB test). App smoke pending.

## 2026-06-01 — ui-settings (store dead-duplicate sweep)
- Removed: apps/code dead settings-store duplicates after the canonical port to packages/ui/src/features/settings — `features/settings/stores/{settingsStore,settingsDialogStore}.{ts,test.ts}` and `renderer/stores/settingsStore.{ts,test.ts}` (the old trpc-based sendMessagesWith store, superseded by the merged packages/ui settingsStore).
- Repointed: `features/auth/stores/authStore.ts` -> `@posthog/ui/features/settings/settingsDialogStore` (last straggler).
- Data: canonical UI settings state lives in `@posthog/ui/features/settings/{settingsStore,settingsDialogStore}` (20 + 14 importers). `apps/code/src/main/services/settingsStore.ts` is a separate main-process store (worktree location) and stays.
- Bridge: none. Remaining ui-settings work: move the feature components (components/sections/*) + SETTINGS_SERVICE interface.
- Validation: packages/ui settings tests 11/11; apps/code 0 fallout from the deletions (typecheck down to 1 exogenous error).

## 2026-06-01 — ui-git-interaction (pure logic/utils/state -> packages/ui)
- Moved: host-agnostic git-interaction layer apps/code -> packages/ui/src/features/git-interaction (types, utils/{branchNameValidation,deriveBranchName,diffStats,errorPrompts,fileKey,gitStatusUtils,partitionByStaged}, state/{gitInteractionLogic,gitInteractionStore} + tests). ~20 consumers repointed to @posthog/ui; old copies deleted.
- New shared: packages/shared/src/git-naming.ts (BRANCH_PREFIX), barrel-exported; apps/code @shared/constants re-exports it (single source).
- Data: gitInteractionStore is a thin UI store (zustand + electronStorage via @posthog/ui/workbench/rendererStorage); gitInteractionLogic is pure menu-action logic.
- Deferred (blocked on git-pr-coupled transport): prStatus.tsx (@main PrActionType), trpc-coupled utils (branchCreation/getSuggestedBranchName/gitCacheKeys/updateGitCache), hooks (useGitQueries etc.), components (BranchSelector/CreatePrDialog/etc.) — they consume trpc.git.* via renderer->main and need workspace-client + the coupled ops ported.
- Validation: @posthog/shared+ui+apps/code typecheck clean; 56 ui tests pass; apps/code 2 remaining errors are exogenous.

## 2026-06-01 - ui-permissions + ActionSelector primitive -> packages/ui
- Moved: 14 permission components + types `apps/code/src/renderer/components/permissions` -> `packages/ui/src/features/permissions`; `components/action-selector/*` -> `packages/ui/src/primitives/action-selector` (completes the ui ActionSelector facade); `mcp-app-host-utils` -> `ui/features/mcp-apps/utils`; `posthog-exec-display` -> `ui/features/posthog-mcp/utils`
- Registered: ui deps += `@posthog/agent`, `@modelcontextprotocol/ext-apps`, `@modelcontextprotocol/sdk`
- Cleaned: fixed the dangling `ui/primitives/ActionSelector` re-export (3 ui errors); UI permission rendering no longer lives in apps/code
- Bridge: apps shims `components/{ActionSelector,permissions/PermissionSelector,permissions/PlanContent}.tsx`, `mcp-apps/utils/mcp-app-host-utils.ts`, `posthog-mcp/utils/posthog-exec-display.ts` — retire as sessions/mcp-apps consumers import `@posthog/ui` directly
- Validation: ui typecheck moved files clean (total 12->9); apps/code my files clean; biome 0 noRestrictedImports

## 2026-06-01 - enrichment boundary types -> @posthog/shared (unblocks ui-code-editor)
- Moved: SerializedEnrichment/SerializedFlag/SerializedEvent (+ nested) + FlagType + StalenessReason from `packages/enricher/src/{serialize,types}.ts` -> `packages/shared/src/enrichment.ts` (zero-dep, renderer-safe)
- Registered: shared barrel `export * from "./enrichment"`; enricher += `@posthog/shared` dep and re-exports the types from serialize.ts/types.ts (single source of truth; apps/code + ws-server keep importing from `@posthog/enricher`)
- Data: source of truth is `@posthog/shared/enrichment`; the enricher scan (ws-server) produces them, the renderer (ui code-editor) renders them
- Cleaned: ui code-editor enrichment files (postHogEnrichment, enrichmentPopoverStore) now import from `@posthog/shared` instead of the layer-restricted `@posthog/enricher` (biome noRestrictedImports satisfied)
- Validation: shared+enricher dists rebuilt; ws-server typecheck 0; apps enricher/code-editor clean; ui biome 0 noRestrictedImports

## 2026-06-01 — mcp-servers (renderer presentational + pure + assets -> packages/ui)
- Moved: pure logic (mcpFilters/mcpToolBulk/statusBadge), presentational components (ToolPolicyToggle/ToolRow/AddCustomServerForm/ServerCard/McpInstalledRail/MarketplaceView/icons), and 36 service-logo assets -> packages/ui/src/features/mcp-servers + packages/ui/src/assets/services. Added *.png to packages/ui/src/assets.d.ts.
- Data: types/client via @posthog/api-client/posthog-client (ui already depends on api-client). No state owned by the moved layer (pure + presentational).
- Deferred: useMcpServers/useMcpInstallationTools hooks + McpServersView/ServerDetailView views — use main-router useTRPC subscriptions + trpcClient.mcpCallback; need an MCP_OAUTH port + ui->main subscription bridge.
- Validation: ui + apps/code typecheck clean; 16 ui mcp-servers tests pass; apps/code 1 exogenous error.

## 2026-06-01 - git-pr (generateCommitMessage) -> @posthog/core/git-pr (main-hosted)
- Moved: commit-message generation orchestration from the 2049-LOC apps `GitService` -> new `packages/core/src/git-pr/` (GitPrService) — pure, host-agnostic, unit-testable
- Registered: `gitPrModule` (binds GIT_PR_SERVICE); ports GIT_DIFF_SOURCE (git CLI reads — core can't import @posthog/git) + GIT_PR_LOGGER, bound in apps container; LLM via core LLM_GATEWAY_SERVICE
- Data: prompt-building + LLM call now testable in isolation; git diffs flow through a port
- Cleaned: business logic out of the apps GitService bridge; GitService.generateCommitMessage is now a 3-line delegate (router + CreatePrSaga unchanged)
- Bridge: GitService delegates to GIT_PR_SERVICE (injected); retire once router/saga call GIT_PR_SERVICE directly
- Validation: core typecheck 0 + biome 0 noRestrictedImports (purity gate) + 2 core tests; git service.test 27/27; ws-server 0

## 2026-06-01 - git-pr (generatePrTitleAndBody) -> @posthog/core/git-pr; GitService LLM-decoupled
- Moved: PR title/body generation -> GitPrService (core). Widened GIT_DIFF_SOURCE port (default/current branch, diff-against-remote, commits-between-branches, PR template, fetch-if-stale).
- Cleaned: GitService no longer depends on the LLM gateway at all (removed the injection) — both commit-message and PR-description generation now live in core; GitService is a thin delegate for them.
- Validation: core 0 + 4 git-pr tests + purity gate; git service.test 27/27

## 2026-06-01 - git-pr (CreatePrSaga) -> @posthog/core/git-pr; orchestration COMPLETE
- Moved: CreatePrSaga -> packages/core/src/git-pr/create-pr-saga.ts. Used lightweight structural dep types (no git-schema-graph relocation); @posthog/git getHeadSha + operation-manager soft-reset became deps (getHeadSha + resetSoft).
- Result: ALL git-pr orchestration (generateCommitMessage + generatePrTitleAndBody + CreatePrSaga) now in @posthog/core/git-pr, pure + unit-tested (7 tests). Host GitService.createPr is integration-only (builds the core saga + SSE progress + session env).
- Validation: core 0 + 7 git-pr tests + purity gate; git service.test 27/27; apps non-mcp-servers 0

## 2026-06-01 - actions + command/FilePicker -> packages/ui
- Moved: `ActionTabIcon` -> `packages/ui/features/actions/ActionTabIcon.tsx` (apps `features/actions` dir now fully removed; `actionStore` was already in ui). `FilePicker` -> `packages/ui/features/command/FilePicker.tsx`.
- Registered: extended the `ShellClient` port (`@posthog/ui/features/terminal/shellClient`) with `destroy()`; host `shellClientAdapter` forwards to `trpcClient.shell.destroy`. ActionTabIcon's only host call now flows through the port — no `@renderer/trpc/client` left in the moved code.
- Data: no owned state moved (ActionTabIcon reads `actionStore`; FilePicker reads `panelLayoutStore` + `useRepoFiles` — all already in ui).
- Cleaned: removed the last app-local consumer references (`panels/usePanelLayoutHooks`, `task-detail/TaskDetail`).
- Bridge: none added. `command/CommandKeyHints.tsx` stays as an app shim only because the still-app-resident `CommandMenu` imports it.
- Validation: ui + apps/code typecheck 0; ui command(6)/repo-files/terminal(7) tests green; biome clean.

## 2026-06-01 - panels (layout half)
- Moved: `apps/code/src/renderer/features/panels/components/{Panel,PanelGroup,PanelResizeHandle,GroupNodeRenderer,PanelDropZones,PanelTree}.tsx` + `hooks/{useDragDropHandlers,usePanelKeyboardShortcuts}.ts` -> `packages/ui/src/features/panels/{components,hooks}/`
- Registered: none (presentational layout primitives over the already-ported panel stores)
- Data: source of truth is `panelLayoutStore` (already in ui); these are pure projections
- Cleaned: relativized self-name imports; `usePanelKeyboardShortcuts` keyboard-shortcuts -> `../../command/keyboard-shortcuts`; added @dnd-kit/react + react-resizable-panels + react-hotkeys-hook to packages/ui
- Bridge: apps `PanelLayout` content cluster (PanelLayout/LeafNodeRenderer/TabbedPanel/PanelTab/DraggableTab/usePanelLayoutHooks) stays until ui-task-detail (TabContentRenderer port), a PANEL_CONTEXT_MENU client port, and handleExternalAppAction/workspaceApi are resolved
- Validation: `pnpm typecheck` 19/19; `@posthog/ui` 508/508; biome check+lint clean

## 2026-06-01 - renderer-shared-hooks (movable remainder)
- Moved: `apps/code/src/renderer/hooks/useAutoFocusOnTyping.ts` -> `packages/ui/src/features/message-editor/useAutoFocusOnTyping.ts` (pure DOM hook; dep only EditorHandle from message-editor types); orphaned colocated tests `useDebounce.test.ts` + `useImagePanAndZoom.test.tsx` -> `packages/ui/src/primitives/hooks/` beside their already-migrated impls
- Registered: none (presentational hook + test relocation; no token/contribution)
- Cleaned: `useAutoFocusOnTyping` self-name import -> relative `./types`; repointed 2 consumers (SessionView, TaskInput) to the package path and deleted the app copy (no shim); added jsdom PointerEvent polyfill to `packages/ui/src/test/setup.ts` (mirrors apps test setup) so pointer-drag hook tests carry `pointerId`
- Bridge: none. Remaining renderer/hooks entries are thin re-export shims or feature-gated (useTask*DeepLink/useTaskContextMenu -> deep-links/task; useRepositoryDirectory -> workspace; useFileWatcher deliberatelyNotSliced)
- Validation: `@posthog/ui` typecheck 0 + full vitest 52 files/565 tests green; `pnpm --filter code typecheck` 0 slice-attributable errors (2 exogenous inbox errors from a concurrent move); biome format clean

## 2026-06-01 - inbox pure layer -> packages/ui
- Moved: inbox pure utils (filterReports, suggestedReviewerFilters, inboxSort, inboxConstants, build{Discuss,CreatePr}ReportPrompt, pendingInboxOpenMethod) + 8 pure presentational/store leaves -> `packages/ui/features/inbox/{utils,components/utils,components/detail,stores}`.
- Data: no owned domain state moved; types now sourced from `@posthog/shared/domain-types` + `@posthog/shared/analytics-events`. `inboxSignalsSidebarStore` is a thin `createSidebarStore` UI store.
- Cleaned: removed app-alias coupling (`@shared/*`, `@utils/logger`) from the moved code; all consumers import from `@posthog/ui`.
- Bridge: none. `inbox/utils/resolveDefaultModel.ts` stays in app (trpcClient); knotted views/hooks remain pending navigationStore/auth/trpc ports.
- Validation: ui + apps/code typecheck 0; ui inbox tests 73/73; biome clean.

## 2026-06-01 - message-editor (suggestion engine + tiptap mentions)
- Moved: `apps/code/src/renderer/features/message-editor/{commands,suggestions/getSuggestions,tiptap/*,components/IssueRow,components/SuggestionStatus}` -> `packages/ui/src/features/message-editor/`
- Registered: `MessageEditorHost` module-setter port (`ports.ts`); desktop adapter `platform-adapters/message-editor-host.ts` set via `setMessageEditorHost` in desktop-services
- Data: suggestions derived from host (`searchGithubRefs`/`fetchRepoFiles`); prompt encoding already in `@posthog/shared` cloud-prompt
- Cleaned: removed direct `trpcClient`/`queryClient`/`@hooks/useRepoFiles` coupling from the suggestion engine + node views; relativized self-name imports
- Bridge: attachment subsystem + editor shell (persistFile, AttachmentsBar/IssuePicker/AttachmentMenu, PromptInput, useTiptapEditor) stay in apps until MessageEditorHost gains the os/git attachment methods
- Validation: `pnpm typecheck` 19/19; `@posthog/ui` 572/572; biome check+lint clean

## 2026-06-01 - ui-code-editor (enrichment vertical)
- Moved: `apps/code/src/renderer/features/code-editor/{hooks/useFileEnrichment.ts,components/EnrichmentPopover.tsx}` -> `packages/ui/src/features/code-editor/{hooks,components}/`
- Registered: NEW `ENRICHMENT_CLIENT` port (`packages/ui/src/features/code-editor/ports.ts`) bound to `TrpcEnrichmentClient` (`apps/code/src/renderer/platform-adapters/enrichment-client.ts`) in `desktop-services.ts`
- Data: source of truth is the workspace-server EnrichmentService (`enrichment.enrichFile`); ui consumes it via the typed client port + TanStack Query, gated on `useAuthStateValue` (ui auth store)
- Cleaned: ui enrichment UI no longer imports `@renderer/trpc`, `@posthog/enricher` (now `@posthog/shared`), or `@features/auth`; openExternal goes through the existing `@posthog/ui/workbench/openExternal` host port
- Bridge: none for the moved files. code-editor tier-2 (CodeEditorPanel/useCodeMirror/useCloudFileContent/CodeMirrorEditor) remains in apps until a contextMenu client port + workspace/sidebar/task-detail hooks land
- Validation: `@posthog/ui` typecheck 0 + full vitest 55 files/580 tests; `pnpm --filter code typecheck` 0 slice-attributable errors (3 exogenous message-editor errors from a concurrent move); biome format clean

## 2026-06-01 - message-editor clean components + host-port clipboard ops -> packages/ui
- Moved: analytics types, AdapterIndicator, ModeSelector, PromptHistoryDialog, tiptap/useDraftSync -> packages/ui/features/message-editor.
- Registered: extended MessageEditorHost port (saveClipboardImage/Text/File, downscaleImageFile); desktop adapter forwards to trpcClient.os.*. The non-React persistFile module consumes the port (no @renderer import).
- Data: no owned state moved; PromptHistoryDialog analytics via @posthog/shared/analytics-events + @posthog/ui/workbench/analytics.
- Validation: full typecheck 19/19; ui message-editor tests 62/62; biome clean.

## 2026-06-01 - sidebar groupTasks + props-driven items -> packages/ui
- Moved: groupTasks util (repository grouping; deps now @posthog/shared) + SidebarItem base + nav item leaves (Skills/McpServers/CommandCenter/Search/Home/SidebarKbdHint) + SidebarTrigger + DraggableFolder -> packages/ui/features/sidebar.
- Data: groupTasks is pure (Task[] -> grouped); items are props-driven (no store/trpc reach-ins).
- Validation: full typecheck 19/19; ui sidebar tests 41/41; biome clean.

## 2026-06-01 - message-editor (attachment subsystem + editor shell — feature complete)
- Moved: `persistFile`, `useTiptapEditor`, `AttachmentsBar`, `IssuePicker`, `AttachmentMenu`(+test), `PromptInput`, `message-editor.css` -> `packages/ui/src/features/message-editor/`
- Registered: `MessageEditorHost` now 13 methods (git refs/gh-status, os clipboard/attachments/data-url, fs read, repo files, dir picker); desktop adapter `platform-adapters/message-editor-host.ts`
- Cleaned: attachment components converted from `useTRPC().queryOptions` to `useQuery` manual keys over the host; removed all `trpcClient`/`queryClient`/`@renderer` coupling
- Bridge: only `PromptInput.stories.tsx` (storybook) + `README.md` remain in apps (host-appropriate)
- Validation: `pnpm typecheck` 19/19; `@posthog/ui` 612/612; message-editor 64/64; biome clean

## 2026-06-01 - git-cache keystone (read + invalidation layer -> ui)
- Moved: `apps/code/src/renderer/features/git-interaction/{utils/gitCacheKeys.ts,hooks/useGitQueries.ts}` -> `packages/ui/src/features/git-interaction/{gitCacheKeys.ts,useGitQueries.ts}`
- Registered: host-set `setQueryClient` (`@posthog/ui/workbench/queryClient`) + `setGitCacheKeyProvider` (`@posthog/ui/features/git-interaction/gitCacheProvider`) + DI binding `GIT_QUERY_CLIENT` -> `TrpcGitQueryClient`, all wired in `desktop-services.ts`
- Data: git read data source of truth is the host git router (forwards to workspace-server); cache **keys** are host-supplied (the real tRPC keys) so packages/ui invalidation stays byte-coherent with the host's read queries
- Cleaned: git read hooks + cache invalidation no longer import `@renderer/trpc`/`@utils/queryClient`; they go through `GIT_QUERY_CLIENT` (data) + the host-set key/queryClient providers
- Bridge: apps shims at the old `utils/gitCacheKeys.ts` + `hooks/useGitQueries.ts` paths re-export from `@posthog/ui` (≈14 consumers unchanged); git result types (`GitSyncStatus`/`GitRepoInfo`/etc.) are declared in ui `ports.ts` until git-domain-types-to-shared relocates them. Git WRITE ops + createPr-progress subscription + components still in apps.
- Validation: `@posthog/ui` typecheck 0 + vitest 58 files/612 tests; `pnpm --filter code` typecheck 0; useBranchMismatchDialog/BranchSelector/ReviewShell tests green

## 2026-06-01 - navigation-store

- Moved: `apps/code/src/renderer/stores/navigationStore.ts` -> `packages/ui/src/features/navigation/store.ts` (+ `taskBinder.ts`, `store.test.ts`)
- Registered: `setNavigationTaskBinder` (NavigationTaskBinder port) + `setActiveTaskContextHandler` (analytics) wired in `apps/code/src/renderer/desktop-services.ts` / `utils/analytics.ts`
- Data: source of truth is the navigation store's `view` + `history`; `canGoBack`/`canGoForward` are derived
- Cleaned: removed store-owned multi-step flow + cross-store reach-in from `navigateToTask` (workspace/folder auto-registration now a host adapter behind `NavigationTaskBinder`)
- Bridge: `apps/code/src/renderer/stores/navigationStore.ts` re-export shim remains (33 consumers); `platform-adapters/navigation-task-binder.ts` holds host orchestration until it moves to a main/core service emitting events
- Validation: `@posthog/ui` typecheck 0 + 639 ui tests (navigation 16/16); `code` typecheck 0; biome clean. Live Electron smoke pending.

## 2026-06-01 - code-editor (CodeMirror hook + view)
- Moved: `apps/code/src/renderer/features/code-editor/hooks/useCodeMirror.ts` -> `packages/ui/src/features/code-editor/hooks/useCodeMirror.ts`
- Moved: `apps/code/src/renderer/features/code-editor/components/CodeMirrorEditor.tsx` -> `packages/ui/src/features/code-editor/components/CodeMirrorEditor.tsx`
- Registered: consumes existing `FILE_CONTEXT_MENU_CLIENT` + `WORKSPACE_CLIENT` (no new tokens; both already bound in desktop-services.ts)
- Cleaned: useCodeMirror dropped trpcClient/workspaceApi/handleExternalAppAction direct imports (host-agnostic via useService); CodeMirrorEditor SerializedEnrichment now from @posthog/shared (was @posthog/enricher, layer violation)
- Bridge: none (apps CodeEditorPanel repointed to @posthog/ui; no shim left)
- Validation: pnpm typecheck 19/19; biome lint 0 noRestrictedImports on packages/ui/src/features/code-editor

## 2026-06-01 - git-interaction (write + orchestration tier)

- Moved: `apps/code/src/renderer/features/git-interaction/hooks/useGitInteraction.ts` -> `packages/ui/src/features/git-interaction/useGitInteraction.ts`
- Moved: `.../hooks/usePrActions.ts` -> `packages/ui/src/features/git-interaction/usePrActions.ts`
- Moved: `.../utils/{updateGitCache,branchCreation,getSuggestedBranchName}.ts` (+branchCreation.test) -> `packages/ui/src/features/git-interaction/utils/`
- Registered: `GIT_WRITE_CLIENT` (packages/ui/.../git-interaction/ports.ts) bound to `TrpcGitWriteClient` (apps/code/.../platform-adapters/git-write-client.ts) in desktop-services; added `WorkspaceClient.linkBranch`
- Data: source of truth is the host git service (workspace-server); write mutations return `GitStateSnapshot` projections that update the read caches via the host-registered `gitQueryKey` provider (coherent by construction)
- Cleaned: removed trpcClient/electron/auth-service-locator coupling from the orchestration hub; os.openExternal -> openExternalUrl port, auth -> useOptionalAuthenticatedClient, workspace.linkBranch -> WORKSPACE_CLIENT
- Bridge: apps re-export shims at all old hook/util paths (12 consumers) remain until those consumers import from @posthog/ui directly; branchCreation shim supplies the writeClient via container.get at the app boundary
- Validation: `pnpm typecheck` 19/19; `@posthog/ui` 639/639; apps BranchSelector.test 5/5; biome lint/check clean

## 2026-06-01 - task-detail (cloud-extract + leaves)
- Moved: `apps/code/.../task-detail/utils/cloudToolChanges.ts` (+test) -> `packages/ui/src/features/task-detail/utils/`
- Moved: `apps/code/.../task-detail/components/{ActionPanel,ExternalAppsOpener}.tsx` -> `packages/ui/src/features/task-detail/components/`
- Cleaned: @shared/types->@posthog/shared/domain-types; @shared/types/session-events->@posthog/shared; handleExternalAppAction/keyboard-shortcuts/useExternalApps/ActionTerminal -> @posthog/ui relative
- Bridge: none (all consumers repointed to @posthog/ui; no shims)
- Validation: pnpm typecheck 19/19; ui cloudToolChanges 15/15; biome 0 noRestrictedImports

## 2026-06-01 - code-review (reviewShellParts split)
- Moved: pure helpers/hooks/types/sub-components out of `apps/.../code-review/components/ReviewShell.tsx` -> NEW `packages/ui/src/features/code-review/reviewShellParts.tsx`
- Kept in apps: the `ReviewShell` component (host-only ChangesPanel + pierre Vite worker + virtua)
- Bridge: apps `ReviewShell.tsx` `export *`-re-exports the parts (retire when ReviewPage/CloudReviewPage/cluster import from @posthog/ui directly)
- Validation: pnpm typecheck 19/19; ui code-review 27/27; ReviewShell.test 4/4; biome 0 noRestrictedImports

## 2026-06-01 - tasks-read + cloud-run hook tiers

- Moved: `useCloudEventSummary`/`useCloudRunState`/`useCloudChangedFiles` -> `packages/ui/src/features/task-detail/hooks/`; `useTaskDiffSummaryStats` -> `packages/ui/src/features/code-review/hooks/`
- Split: tasks READ hooks (`useTasks`/`useTaskSummaries`/`useSlackTasks`) -> `packages/ui/src/features/tasks/useTasks.ts`; mutation hooks remain in `apps/code` (host-coupled)
- Data: tasks list = api-client read (useAuthenticatedQuery); cloud changed-files derived from session events + PR/branch git queries
- Bridge: apps re-export shims at all moved hook paths; tasks mutations + `getSessionService.updateSessionTaskTitle` coupling remain until a sessions-title-sync port lands
- Validation: ui+code typecheck 0; ui tests 113/113; biome clean

## 2026-06-01 - code-editor (CodeEditorPanel keystone — feature fully drained)
- Moved: `apps/code/.../code-editor/components/CodeEditorPanel.tsx` + `.../hooks/useCloudFileContent.ts` -> `packages/ui/src/features/code-editor/`
- Registered: NEW `FILE_CONTENT_CLIENT` (packages/ui/.../code-editor/ports.ts: readRepoFile/readAbsoluteFile/readFileAsBase64) bound to `TrpcFileContentClient` (apps/code/.../platform-adapters/file-content-client.ts) in desktop-services
- Added: `packages/ui/.../code-editor/hooks/useFileContent.ts` (useRepoFileContent/useAbsoluteFileContent/useFileAsBase64) — useService(FILE_CONTENT_CLIENT) + useQuery keyed via the host-registered `fsQueryKey` provider, so keys stay byte-coherent with the host's other fs reads
- Data: source of truth is workspace-server fs (file contents); panel is read-only, cloud reads derive from session tool-call events (useCloudFileContent)
- Cleaned: dropped `useTRPC`/`trpcClient.os.openExternal` from the panel (fs.* -> port hooks; openExternal -> `openExternalUrl`); `@features/*` + `@shared/types` -> relative/`@posthog/shared`
- Drained `editor` feature too: repointed `useTaskCreation` (buildCloudTaskDescription) + `sagas/task/task-creation` (buildPromptBlocks) -> `@posthog/ui/features/editor` and deleted the re-export shims. `apps/code/.../features/{code-editor,editor}` are now empty.
- Bridge: none (sole panel consumer TabContentRenderer repointed directly; no shims left)
- Validation: `pnpm typecheck` 19/19; `@posthog/ui` 706/706; biome lint 0 noRestrictedImports on code-editor. Live Electron GUI smoke deferred (shared-tree WIP).

## 2026-06-01 - onboarding/tour assets + clean leaves (ui-onboarding partial)

- Moved: `apps/code/src/renderer/assets/images/hedgehogs/{builder-hog-03,explorer-hog,happy-hog}.png` -> `packages/ui/src/assets/hedgehogs/` (+ new `packages/ui/src/assets/hedgehogs.ts` URL manifest)
- Moved: `apps/code/src/renderer/assets/logo.tsx` -> `packages/ui/src/primitives/Logo.tsx` (pure SVG, zero deps)
- Moved: `WelcomeScreen.tsx` -> `packages/ui/src/features/onboarding/components/`; `createFirstTaskTour.ts` -> `packages/ui/src/features/tour/tours/`
- Data: assets are static URLs; manifest re-exports them by name (cross-package raw `.png` import is not resolvable via the `@posthog/ui` exports map, a `.ts` manifest is — mirrors the sounds-asset precedent)
- Cleaned: 14 hedgehog import sites + Logo + 3 moved-file consumers repointed to `@posthog/ui`; no shims left
- Bridge: none
- Validation: `pnpm typecheck` 19/19; `@posthog/ui` vitest 67 files / 706 tests; biome check clean. Live Electron smoke deferred (shared-tree WIP).
- Remaining: onboarding/setup components still gated on auth/integrations/projects/folder-picker/analytics(`track`) ports (GitHubConnectPanel is the keystone).

## 2026-06-01 - shell SpaceSwitcher leaf (ui-shell partial)

- Moved: `apps/code/src/renderer/components/SpaceSwitcher.tsx` -> `packages/ui/src/workbench/SpaceSwitcher.tsx`
- Cleaned: deps repointed to `@posthog/ui`/`@posthog/shared`; sole consumer MainLayout repointed; no shim
- Validation: `@posthog/ui` typecheck 0 + 706 tests; biome clean

## 2026-06-01 - git-interaction (useFixWithAgent + CreatePrDialog)
- Moved: `apps/code/.../git-interaction/hooks/useFixWithAgent.ts` -> `packages/ui/src/features/git-interaction/useFixWithAgent.ts`
- Moved: `apps/code/.../git-interaction/components/CreatePrDialog.tsx` -> `packages/ui/src/features/git-interaction/components/CreatePrDialog.tsx`
- Cleaned: useFixWithAgent now consumes ui paths only (useSession/sendPromptToAgent/navigation store/errorPrompts); CreatePrDialog's last app-local dep (GitInteractionDialogs shim) is now a relative import; self-imports relativized
- Bridge: none. Consumers repointed directly — CreatePrDialog's `useFixWithAgent` import, TaskActionsMenu + CreatePrDialog.stories (stories stay in apps/code; storybook is app-only) now import CreatePrDialog from `@posthog/ui`
- Gated: useCloudPrUrl/useTaskPrUrl/TaskActionsMenu chain blocked on tasks reconciliation (apps useTasks vs ui useTasks are distinct impls with different query keys); useTaskPrUrl additionally needs trpc.git.getPrStatus -> GIT_QUERY_CLIENT.getPrStatus + gitQueryKey
- Validation: `pnpm typecheck` 19/19; `@posthog/ui` git-interaction 6 files/71 tests; biome lint 0 noRestrictedImports

## 2026-06-01 - inbox SignalReport-card chain (ui-inbox partial)

- Moved: inbox `{utils/ReportImplementationPrLink, utils/ReportCardContent, detail/MultiSelectStack, list/ReportListRow, list/ReportListPane}` -> `packages/ui/src/features/inbox/components/*`
- Cleaned: `usePrDetails`->ui git-interaction; `SignalReport`->`@posthog/shared/domain-types`; apps consumers (ReportDetailPane, InboxSignalsTab) repointed; no shims
- Validation: `@posthog/ui` typecheck 0 + 710 tests; biome clean

## 2026-06-01 - code-review (page/shell tier)

- Moved: `apps/code/.../code-review/components/{ReviewShell,ReviewPage,CloudReviewPage}.tsx` + `hooks/useDiffStatsToggle.ts` -> `packages/ui/src/features/code-review/` (apps/code/features/code-review now all shims + one host-bindings file)
- Registered: `reviewHost.ts` (setReviewDiffWorkerFactory / setReviewExpandedSidebarRenderer); wired by apps `reviewHostBindings.tsx` (side-effect import in `main.tsx`)
- Data: untracked-file prefetch source of truth is the host fs via `REVIEW_FILE_CLIENT` (new batch `readRepoFilesBounded`); cache keys derived from host-set `fsQueryKey` so prefetch stays coherent with `useReadRepoFileBounded`
- Cleaned: ReviewShell no longer imports task-detail ChangesPanel or the Vite worker URL directly — both injected by the host
- Bridge: `apps/.../code-review/reviewHostBindings.tsx` supplies the pierre worker (host/bundler) + ChangesPanel sidebar slot; sidebar half retires when task-detail's ChangesPanel lands in `packages/ui`. Component/hook shims retire when consumers import `@posthog/ui` directly.
- Validation: `pnpm typecheck` 19/19; ui code-review vitest 710 pass; biome clean. Live review-pane smoke pending (no headless Electron).

## 2026-06-01 - sessions context-usage + plan-status leaves (sessions partial)

- Moved: sessions `{PlanStatusBar, ContextUsageIndicator, ContextBreakdownPopover(+test), utils/contextColors}` -> `packages/ui/src/features/sessions/*`
- Cleaned: contextColors -> `@posthog/ui/features/sessions/contextColors`; consumers SessionView/SessionFooter/PlanStatusBar.stories repointed; no shims
- Validation: `@posthog/ui` typecheck 0 + moved test 3/3 + 719 ui tests; biome clean

## 2026-06-01 - git-interaction (PR-url chain + BranchSelector)
- Moved: `useCloudPrUrl.ts`, `useTaskPrUrl.ts`, `components/TaskActionsMenu.tsx`, `components/BranchSelector.tsx` (+test) -> `packages/ui/src/features/git-interaction/`
- Registered: added `checkoutBranch` to `GIT_WRITE_CLIENT` port + `TrpcGitWriteClient` adapter
- Cleaned: useTaskPrUrl + BranchSelector dropped `useTRPC`; git reads now go through `useService(GIT_QUERY_CLIENT)` + `gitQueryKey` provider, branch checkout through `useService(GIT_WRITE_CLIENT)` (cache coherence preserved via the host-registered key provider)
- Data: corrected a false gate — apps `useTasks` already re-exports the ui read hooks, so the PR-url chain was never tasks-divergent
- Bridge: apps shims at `useCloudPrUrl`/`useTaskPrUrl` (CommandCenter consumers); TaskActionsMenu/BranchSelector consumers (HeaderRow/TaskInput) repointed directly, no shim
- Remaining: `CloudGitInteractionHeader` (sessions-gated) is the only real app-side file left in the feature
- Validation: `pnpm typecheck` 19/19; `@posthog/ui` git-interaction 7 files/76 tests; biome lint 0 noRestrictedImports

## 2026-06-01 - onboarding (clean leaves)

- Moved: `InviteCodeStep.tsx`, `SelectRepoStep.tsx`, `hooks/useProjectsWithIntegrations.ts` -> `packages/ui/src/features/onboarding/`
- Data: extracted `DetectedRepo` interface -> `packages/ui/src/features/onboarding/types.ts` (apps `useOnboardingFlow` re-exports it; unblocks SelectRepoStep without porting the still-trpc-coupled hook)
- Bridge: apps shims for the 3 moved files (consumers OnboardingFlow + GitHubConnectPanel unchanged); retire when those consumers land in ui
- Validation: `@posthog/ui typecheck` 0; biome clean

## 2026-06-01 - sidebar (TaskListView + Sidebar leaves)

- Moved: `apps/code/src/renderer/features/sidebar/components/TaskListView.tsx` -> `packages/ui/src/features/sidebar/components/TaskListView.tsx`
- Moved: `apps/code/src/renderer/features/sidebar/components/Sidebar.tsx` -> `packages/ui/src/features/sidebar/components/Sidebar.tsx`
- Data: source of truth is `useSidebarData` (already in ui); TaskListView is fully props-driven projection
- Cleaned: TaskListView imports repointed to package paths (useFolders/useWorkspace/useMeQuery/navigation + @posthog/shared utils); Sidebar uses `@posthog/ui/primitives/ResizableSidebar`
- Bridge: apps `features/sidebar/components/index.tsx` barrel re-exports `Sidebar` from ui; SidebarMenu imports TaskListView from ui directly (no shim)
- Validation: `pnpm --filter @posthog/ui typecheck`, `pnpm --filter code typecheck`, ui sidebar vitest 41/41, biome clean

## 2026-06-01 - setup discovery (ui-onboarding)

- Moved: `apps/code/src/renderer/features/setup/components/DiscoveredTaskDetailDialog.tsx` -> `packages/ui/src/features/setup/DiscoveredTaskDetailDialog.tsx`
- Moved: `apps/code/src/renderer/features/setup/hooks/useSetupDiscovery.ts` -> `packages/ui/src/features/setup/useSetupDiscovery.ts`
- Registered: `setupUiModule` (`packages/ui/src/features/setup/setup.module.ts`, binds `SetupRunService` singleton) loaded in `desktop-contributions.ts`
- Cleaned: `useSetupDiscovery` now resolves `SetupRunService` via `useService` instead of renderer-container `get(RENDERER_TOKENS.SetupRunService)`; removed the dead `RENDERER_TOKENS.SetupRunService` token + `di/container.ts` binding
- Bridge: app shims at `features/setup/components/DiscoveredTaskDetailDialog.tsx` (consumer task-detail/SuggestedTasksPanel) and `features/setup/hooks/useSetupDiscovery.ts` (consumer MainLayout) — retire when those consumers move to packages
- Validation: `pnpm typecheck` 19/19; ui setup vitest 14/14; biome lint clean

## 2026-06-01 - sessions (cloneStore forbidden-pattern fix)

- Moved: clone subscription + auto-dismiss timer out of `packages/ui/.../clone/cloneStore.ts` into `clone.contribution.ts` (boot `WORKBENCH_CONTRIBUTION`); `startClone` orchestration -> `clone/cloneActions.ts`
- Registered: `cloneUiModule` (`clone.module.ts`) in `apps/code/src/renderer/desktop-contributions.ts`
- Data: source of truth is the host clone lifecycle (main git service `CloneProgress` events); `cloneStore.operations` is a pure projection; `isCloning`/`getCloneForRepo` are derived
- Cleaned: removed store-owned module subscription, domain-cleanup `setTimeout`, and in-store orchestration (3 AGENTS.md forbidden patterns)
- Note: `startClone` currently has no callers (clone-progress feature is dead) — patterns removed + capability preserved, not deleted
- Validation: `@posthog/ui typecheck` 0; `cloneStore.test` 7/7; biome clean

## 2026-06-01 - integrations github-connect tier + onboarding github step

- Moved: `apps/.../features/auth/hooks/useOrgRole.ts` -> `packages/ui/src/features/auth/useOrgRole.ts`
- Moved: `apps/.../features/integrations/hooks/useGitHubIntegrationCallback.ts` + `useGithubUserConnect.ts` -> `packages/ui/src/features/integrations/`
- Moved: `apps/.../features/onboarding/components/GitHubConnectPanel.tsx` + `ConnectGitHubStep.tsx` -> `packages/ui/src/features/onboarding/components/`
- Registered: `GITHUB_INTEGRATION_CLIENT` port (`packages/ui/src/features/integrations/ports.ts`) + desktop adapter `platform-adapters/github-integration-client.ts` bound in `desktop-services.ts`
- Data: source of truth is the host GitHub integration service (callbacks/pending-callback/flow events); ui consumes via the port + RQ cache invalidation
- Cleaned: subscriptions go through `client.onCallback/onFlowTimedOut` (useService) instead of `useTRPC().githubIntegration.*`; `trpc.os.openExternal` -> `openExternalUrl`; `IS_DEV` -> `import.meta.env.DEV`
- Bridge: apps shims for `useOrgRole` + `useGithubUserConnect` re-export from ui (consumers in App/settings/inbox/task-detail unchanged); retire when those features land
- Validation: ui typecheck 0; full ui vitest 736/736; biome clean

## 2026-06-01 - billing/utils (layer fix)

- Moved: `apps/code/src/renderer/features/billing/utils.ts` (+test) -> `packages/ui/src/features/billing/utils.ts`
- Cleaned: `UsageOutput` type import moved from `@main/services/llm-gateway/schemas` -> `@posthog/core/llm-gateway/schemas` (removes a main->renderer cross-process type coupling; ui->core is an allowed edge)
- Bridge: app shim at `features/billing/utils.ts` — retire when SidebarUsageBar/UsageLimitModal/billing subscriptions/PlanUsageSettings move to packages
- Validation: ui typecheck 0; ui billing utils vitest 11/11; biome clean

## 2026-06-01 - inbox (component tier)

- Moved: `apps/code/src/renderer/features/inbox/components/{InboxEmptyStates,SignalSourceToggles}.tsx`, `components/detail/SignalCard.tsx`, `components/list/{SuggestedReviewerFilterMenu,SignalsToolbar}.tsx`, `hooks/{useInboxBulkActions,useSignalSourceManager}.ts` -> `packages/ui/src/features/inbox/...`; `components/ui/RelativeTimestamp.tsx` -> `packages/ui/src/primitives/`; `assets/images/mail-hog.png` -> `packages/ui/src/assets/images/`
- Data: inbox report truth owned by api-client query cache key `["inbox","signal-reports"]` (ui read hooks); useInboxBulkActions invalidates the same key — single source preserved across the move
- Cleaned: dropped false auth coupling (all auth read-path already in `@posthog/ui/features/auth`); `@renderer/api/posthogClient` (shim) repointed to `@posthog/api-client/posthog-client`
- Bridge: apps shims at `features/inbox/components/SignalSourceToggles.tsx`, `features/inbox/hooks/{useInboxBulkActions,useSignalSourceManager}.ts`, `components/ui/RelativeTimestamp.tsx` remain until settings (SignalSourcesSettings/SignalSlackNotificationsSettings) consumers import from `@posthog/ui` directly
- Validation: `pnpm --filter @posthog/ui typecheck` (0); ui inbox vitest 76 tests; biome clean; `pnpm --filter code typecheck` (0 in inbox paths)

## 2026-06-01 - sessions (pure helper extraction)

- Moved: `buildCloudDefaultConfigOptions`/`extractLatestConfigOptionsFromEntries` -> `packages/ui/.../sessions/cloudSessionConfig.ts`; `hasSessionPromptEvent`/`isAbsoluteFolderPath`/`promptReferencesAbsoluteFolder` -> `packages/ui/.../sessions/session.ts`
- Cleaned: renderer `service/service.ts` no longer defines these; imports them from ui; dropped unused `@posthog/agent/execution-mode` import
- Bridge: `isTurnCompleteEvent` stays in `service/service.ts` (needs `@posthog/agent` root barrel, forbidden in ui; no browser-safe acp-extensions subpath)
- Validation: ui typecheck 0; ui tests 41/41; apps/code typecheck 0; biome 0 noRestrictedImports

## 2026-06-02 - task-detail (leaves)

- Moved: `apps/code/src/renderer/components/TreeDirectoryRow.tsx` -> `packages/ui/src/primitives/`; `features/task-detail/components/{CloudGithubMissingNotice,ChangesTreeView}.tsx` -> `packages/ui/src/features/task-detail/components/`
- Cleaned: dropped false auth/integrations coupling (auth read-path + github-connect already in `@posthog/ui`); `@components/TreeDirectoryRow` -> `@posthog/ui/primitives/TreeDirectoryRow`, `@shared/types` -> `@posthog/shared/domain-types`
- Bridge: apps shim `components/TreeDirectoryRow.tsx` remains until ChangesPanel/FileTreePanel move to packages/ui
- Validation: `@posthog/ui` typecheck (0); `code` typecheck (0); ui task-detail vitest 20 tests; biome clean

## 2026-06-02 - agent: ./acp-extensions subpath + sessions moves

- Added: `@posthog/agent/acp-extensions` browser-safe subpath export (pure ACP notification consts + `isNotification`); tsup entry + package.json exports, dist rebuilt
- Moved: `isTurnCompleteEvent` -> `packages/ui/.../sessions/session.ts`; `cloudRunIdleTracker.ts` -> `packages/ui/.../sessions/` (git mv, +test 9/9)
- Cleaned: renderer `service/service.ts` imports both from `@posthog/ui`; agent-root barrel no longer needed for these
- Enabler: ui code may now import `isNotification`/`POSTHOG_NOTIFICATIONS` from `@posthog/agent/acp-extensions` instead of the forbidden root barrel
- Validation: agent build OK; ui session 29/29 + cloudRunIdleTracker 9/9; service typecheck clean; biome clean

## 2026-06-02 - onboarding InstallCliStep + git-status read port

- Moved: `apps/.../features/onboarding/components/InstallCliStep.tsx` -> `packages/ui/src/features/onboarding/components/`
- Registered: `getGitStatus` added to `GIT_QUERY_CLIENT` port + `git-query-client.ts` adapter
- Cleaned: InstallCliStep off `useTRPC` -> `useService(GIT_QUERY_CLIENT)` + `gitQueryKey`/`gitPathFilter` for cache-coherent reads/invalidation; `trpc.os.openExternal` -> `openExternalUrl`
- Bridge: none (OnboardingFlow repointed; sole consumer)
- Validation: ui git-interaction vitest 76/76; ui+apps typecheck clean in touched paths; biome clean

## 2026-06-02 - billing useUsage/useFreeUsage

- Moved: `apps/code/.../features/billing/hooks/{useUsage,useFreeUsage}.ts` -> `packages/ui/src/features/billing/`
- Registered: `UsageClient` port (`packages/ui/src/features/billing/usageClient.ts`) + desktop adapter `RendererUsageClient` (`platform-adapters/usage-client.ts`), wired via `setUsageClient` in desktop-services
- Data: `useUsage` owns the usageMonitor.getLatest cache solely -> ui-owned query key `["billing","usage","latest"]` (no host key provider needed); onUsageUpdated subscription writes that key
- Cleaned: removed renderer trpc coupling (`useTRPC`/`useSubscription`) from the usage read path; `UsageOutput` from `@posthog/core/usage/schemas`
- Bridge: app shims at both hook paths — retire when PlanUsageSettings + SidebarUsageBar move to packages
- Validation: pnpm typecheck 19/19; ui billing vitest 53/53; biome clean

## 2026-06-02 - sidebar (ProjectSwitcher)

- Moved: `apps/code/src/renderer/features/sidebar/components/ProjectSwitcher.tsx` -> `packages/ui/src/features/sidebar/components/`
- Cleaned: replaced `trpcClient.os.openExternal` with the `openExternalUrl` platform port; dropped false auth/projects/command coupling (all already in `@posthog/ui`)
- Bridge: none (sole consumer SidebarContent repointed directly)
- Validation: `@posthog/ui` typecheck (0); `code` typecheck (0); ui sidebar vitest 41 tests; biome clean

## 2026-06-02 - billing flags + SidebarUsageBar

- Moved: feature-flag constants -> `packages/shared/src/flags.ts`; `SidebarUsageBar.tsx` -> `packages/ui/src/features/billing/`
- Cleaned: flag strings now host-agnostic in @posthog/shared; `apps/code/src/shared/constants.ts` re-exports them (additive shim); SidebarUsageBar fully on ui/shared imports
- Bridge: app shim at `features/billing/components/SidebarUsageBar.tsx` — retire when SidebarContent moves
- Validation: shared+ui+code typecheck 0 in touched paths; ui billing vitest 53/53; biome clean

## 2026-06-02 - deep-links (useNewTaskDeepLink) + git getGithubIssue port

- Moved: `apps/.../hooks/useNewTaskDeepLink.ts` -> `packages/ui/src/features/deep-links/useNewTaskDeepLink.ts`
- Registered: new `DEEP_LINK_CLIENT` port (`features/deep-links/ports.ts`) + `deep-link-client.ts` adapter bound in `desktop-services.ts`; `getGithubIssue` added to `GIT_QUERY_CLIENT` port + adapter
- Cleaned: tRPC `useSubscription` -> `useEffect` + `client.onNewTaskAction`; `trpcClient.deepLink/git` -> `useService` ports
- Bridge: apps shim `@hooks/useNewTaskDeepLink` re-exports from ui (MainLayout unchanged)
- Validation: ui git-interaction vitest 76/76; ui+apps typecheck clean in touched paths; biome clean

## 2026-06-02 - sessions (cloud-log-gap pure logic)

- Moved: reconcile decision (`classifyCloudLogGap`) + request coalescing (`mergeCloudLogGapRequests`) -> `packages/ui/.../sessions/cloudLogGap.ts`
- Cleaned: `service.ts` reconcileCloudLogGapOnce now delegates the decision to the pure module and shares one `commitReconciledCloudEvents` write path; removed 3 local interfaces + the merge method
- Validation: cloudLogGap 9/9; existing service reconcile tests pass (behavior preserved); typecheck 0 in touched paths; biome clean

## 2026-06-02 - billing subscriptions -> contribution

- Moved: App.tsx inline `registerBillingSubscriptions` -> `packages/ui/src/features/billing/billing.contribution.ts` (BillingContribution); registered via `billing.module.ts` (WORKBENCH_CONTRIBUTION) loaded in desktop-contributions; deleted apps `billing/subscriptions.ts`
- Moved: `UsageLimitModal.tsx` -> ui (os.openExternal -> openExternalUrl port)
- Registered: `onThresholdCrossed` added to UsageClient port + RendererUsageClient adapter
- Cleaned: App.tsx no longer registers the billing subscription inline (ui-shell acceptance #1)
- Validation: pnpm typecheck 19/19; ui billing vitest 53/53; biome clean

## 2026-06-02 - ui-shell App.tsx boot effects -> contributions

- Moved: `initializeUpdateStore` -> `UpdatesContribution` (updates.module.ts); `initializeConnectivityStore`+`initializeConnectivityToast` -> `ConnectivityContribution` (connectivity.module.ts); both WORKBENCH_CONTRIBUTION, loaded in desktop-contributions
- Cleaned: App.tsx no longer registers update/connectivity init inline (acceptance #1)
- Validation: ui+code typecheck 0 (my paths); updates+connectivity vitest 7/7; biome clean

## 2026-06-02 - ui-onboarding (ProjectSelectStep)

- Moved: `ProjectSelectStep.tsx` -> `packages/ui/.../onboarding/components` (imports repointed to ui/shared; apps shim left)
- Added: `useAuthStateFetched()` to `@posthog/ui/features/auth/store`
- Note: `OnboardingFlow` stays — host-coupled via `FullScreenLayout`+`UpdateBanner` + `IS_DEV` (no shared subpath); needs a banner-slot decision
- Validation: ui+app typecheck 0 in touched paths; biome 0 noRestrictedImports

## 2026-06-02 - HedgehogMode port attempt reverted

- Attempted HedgehogMode.tsx -> packages/ui/workbench; reverted: ui biome noRestrictedImports forbids `@posthog/hedgehog-mode` (DOM/canvas lib, "ui must run in any JS environment"). Needs a host-injected game factory port to port; stays app-local for now.

## 2026-06-02 - panels (tab subtree + context-menu port)

- Added: `PANEL_CONTEXT_MENU_CLIENT` platform-style port (`packages/ui/src/features/panels/panelContextMenuClient.ts`) + `TrpcPanelContextMenuClient` adapter (`apps/code/.../platform-adapters/panel-context-menu-client.ts`), bound in `desktop-services.ts`
- Moved: `DraggableTab`, `PanelTab`, `TabbedPanel` -> `packages/ui/src/features/panels/components/`
- Cleaned: replaced direct `trpcClient.contextMenu.show{Tab,Split}ContextMenu` + `workspaceApi`/`handleExternalAppAction` with the port (adapter handles external-app host-side, returns close-family choice)
- Bridge: none for these components (sole consumer `LeafNodeRenderer` repointed)
- Validation: `@posthog/ui` typecheck (0); ui panels vitest 42 tests; `code` typecheck (0 in panels paths); biome clean

## 2026-06-02 - sessions component leaves (5 components + asset + dedup)

- Moved: `CloudInitializingView`, `DiffStatsChip`, `SessionFooter`, `GitActionResult`, `UnifiedModelSelector` (apps sessions/components) -> `packages/ui/src/features/sessions/components/`; `zen.png` -> `packages/ui/src/assets/images/`
- Cleaned: GitActionResult off `useTRPC` -> `useService(GIT_QUERY_CLIENT)` + `gitQueryKey`; `trpc.os.openExternal` -> `openExternalUrl`
- Deduped: `VirtualizedList` (apps dead twin/shim removed; 3 consumers repointed direct to ui)
- Bridge: none (all consumers repointed)
- Validation: ui sessions vitest 78/78; ui+apps typecheck clean in touched paths; biome clean

## 2026-06-02 - HedgehogMode -> ui (host port)

- Moved: `HedgehogMode.tsx` -> `packages/ui/src/workbench/`; new `HedgehogModeHost` port + desktop `RendererHedgehogModeHost` adapter (owns `@posthog/hedgehog-mode`), wired via `setHedgehogModeHost` in desktop-services
- Cleaned: ui no longer references the DOM/canvas hedgehog lib (noRestrictedImports honored); game details live in the adapter, state decision in ui
- Bridge: app shim at `components/HedgehogMode.tsx` — retire when MainLayout moves
- Validation: ui+code typecheck 0; ui biome lint clean

## 2026-06-02 - onboarding (feature complete)

- Moved: `OnboardingFlow.tsx` -> `packages/ui/src/features/onboarding/components/` (steps + hooks + store already in ui)
- Cleaned: dropped `@components/FullScreenLayout`/`@features/auth`/`@hooks`/`@stores`/`@utils` couplings (all ui); `IS_DEV` inlined as `import.meta.env.DEV`; deleted 4 dead apps shims
- Bridge: `OnboardingHogTip.tsx` remains in apps only because auth `InviteCodeScreen` still consumes it (retire with the auth slice)
- Validation: `@posthog/ui` typecheck (0); `code` typecheck (0 in onboarding/App; 14 exogenous tasks/useTasks errors); biome clean

## 2026-06-02 - SkillButtonsMenu -> ui

- Moved: `SkillButtonsMenu.tsx` -> `packages/ui/src/features/skill-buttons/components/` (deps all ui/shared; sendPromptToAgent via existing agentPromptSender port)
- Bridge: app shim at old path (consumers HeaderRow + stories) — retire when HeaderRow moves
- Validation: ui+code typecheck 0; ui skill-buttons vitest 6/6; biome clean

## 2026-06-02 - tasks mutation hooks (session-task bridge)

- Added: `SESSION_TASK_BRIDGE` port (`@posthog/ui/features/sessions/sessionTaskBridge.ts`) + apps adapter (`sessionTaskBridgeAdapter.ts`, wired in `main.tsx`)
- Moved: `useUpdateTask`+`useRenameTask` -> `@posthog/ui/features/tasks/useTaskMutations.ts` (coupling to `getSessionService().updateSessionTaskTitle` now via the bridge); test moved + repointed
- Bridge: apps `useTasks.ts` re-exports both from ui; retire when all consumers import the package directly
- Data: source of truth is the renderer SessionService (host); the bridge is a narrow injected port
- Validation: ui+app typecheck 0 in touched paths; useTaskMutations.test 4/4; biome clean

## 2026-06-02 - useAppBridge -> ui (mcp-apps)

- Moved: `useAppBridge.ts` -> `packages/ui/src/features/mcp-apps/hooks/` (McpUiResource type from @posthog/core/mcp-apps/schemas; ext-apps already a ui dep)
- Bridge: app shim at old path (consumer McpAppHost) — retire when McpAppHost moves
- Validation: ui+code typecheck 0; ui mcp-apps vitest green; biome clean

## 2026-06-02 - skills feature -> ui (SkillsView/SkillDetailPanel)

- Moved: `SkillsView.tsx` + `SkillDetailPanel.tsx` -> `packages/ui/src/features/skills/` (SkillCard + skillsSidebarStore already ui)
- Registered: `SKILLS_CLIENT` port (`@posthog/ui/features/skills/ports.ts`) + `useSkills()` hook; desktop adapter `RendererSkillsClient` (`platform-adapters/skills-client.ts`) bound in `desktop-services.ts`
- Data: source of truth is ws-server `SkillsService` (skills.list); SkillInfo/SkillSource neutral types in `@posthog/shared`. SKILL.md body read reuses `FILE_CONTENT_CLIENT` (useAbsoluteFileContent) for fs-cache coherence; frontmatter stripped client-side
- Cleaned: removed `@renderer/trpc`/`useTRPC` from the skills UI; skills feature now host-agnostic in ui
- Bridge: app shims at `features/skills/components/SkillsView` (consumer MainLayout) + SkillCard + skillsSidebarStore — retire when MainLayout/consumers import the package directly
- Validation: ui typecheck 0; useSkills.test 1/1; biome lint 0 noRestrictedImports. Live GUI smoke deferred (exogenous tree red from concurrent handoff/archive agents)

## 2026-06-02 - tasks-archive-hook (keystone)

- Moved: `apps/code/src/renderer/features/tasks/hooks/useArchiveTask.ts` -> `packages/ui/src/features/archive/useArchiveTask.ts` (old path is a re-export shim)
- Registered: `ArchiveTaskBridge` (packages/ui archive) + host impl `platform-adapters/archive-task-bridge.ts`, side-effect imported in `main.tsx`; extended `archiveCacheProvider` with list + pathFilter keys
- Data: source of truth is ws-server archive service; ui holds optimistic cache writes. `ArchivedTask` domain type added to `@posthog/shared` (ws-server zod schema stays the boundary validator)
- Cleaned: removed the last `@renderer/*` couplings from the archive flow (workspaceApi/pinnedTasksApi/trpcClient.archive now behind the bridge)
- Bridge: `apps/code/.../platform-adapters/archive-task-bridge.ts` + apps `useArchiveTask.ts` shim remain until SidebarMenu/useTaskContextMenu import the package path and useDeleteTask moves behind ports
- Validation: pnpm typecheck 19/19; ui useArchiveTask.test.ts 2/2; renderer vite build

## 2026-06-02 — handoff

- Moved: `apps/code/src/main/services/handoff/handoff-saga.ts` + `handoff-to-cloud-saga.ts` -> `packages/core/src/handoff/` (+ `types.ts` owning `HandoffStep`/`HandoffBaseDeps`/saga input types)
- Cleaned: core imports only `@posthog/shared` — agent runtime (`resumeFromLog`/`formatConversationForResume`) and the `apiClient` calls are injected via `HandoffSagaDeps`; checkpoint typed as shared `GitHandoffCheckpoint` (no generics); `apiClient` removed from the saga
- Data: source of truth is the cloud run log (rebuilt via injected `fetchResumeState`); derived projections are the handoff context summary + checkpointApplied flag
- Bridge: `HandoffService` (apps/code) stays as the saga deps-provider (focus pattern), supplying agent/git/fs host ops; retire its raw fs/git when a workspace-server handoff-host capability lands
- Validation: `@posthog/core` typecheck + 16/16 core saga tests; apps main tsc 0 errors; apps handoff service test 6/6; biome lint core clean

## 2026-06-02 — ui-settings (sections drain)

- Moved: 7 settings sections `apps/code/src/renderer/features/settings/components/sections/{PermissionsSettings,ClaudeCodeSettings,AdvancedSettings,ShortcutsSettings,AccountSettings,GitHubSettings,GitHubIntegrationSection}.tsx` -> `packages/ui/src/features/settings/sections/` (old paths are `export *` re-export shims)
- Registered: new `SETTINGS_PERMISSIONS_PORT` (packages/ui/.../settings/ports.ts) + desktop adapter `apps/code/.../platform-adapters/settings-permissions-client.ts` wrapping `trpc.os.getClaudePermissions`, bound in `desktop-services.ts`
- Data: Permissions reads allow/deny tool lists from the host (source of truth = host Claude settings.json) via the port; other sections consume already-ported ui stores/hooks (settingsStore, auth store/useCurrentUser/useAuthMutations, billing useSeat, integrations useGithubUserConnect/useIntegrations)
- Cleaned: Account/GitHub/GitHubIntegration were FALSE BLOCKERS — their auth/integrations deps already lived in @posthog/ui + @posthog/api-client + @posthog/shared; only import paths changed
- Bridge: app `export *` shims at all 7 sections/* paths remain until SettingsDialog imports the package paths directly (SettingsDialog still apps-side, gated on the remaining inbox/billing/folders/tasks-coupled sections)
- Validation: ui+apps typecheck 0; `vite build -c vite.renderer.config.mts` ✓ (runtime bundle, validates the new port binding); ui settings vitest 11/11; biome clean

## 2026-06-02 - tasks-create-delete-hook (keystone complete)

- Moved: `useCreateTask`/`useDeleteTask` from apps `features/tasks/hooks/useTasks.ts` -> `packages/ui/src/features/tasks/useTaskCrudMutations.ts` (apps useTasks.ts is now a pure re-export shim for all 5 task hooks)
- Registered: `TaskMutationBridge` (packages/ui tasks) + host impl `platform-adapters/task-mutation-bridge.ts`, side-effect imported in `main.tsx`
- Data: source of truth is the PostHog API task CRUD; ui holds the optimistic task-list cache (taskKeys)
- Cleaned: removed the last `@renderer/*` couplings (workspaceApi.get/delete, contextMenu.confirmDeleteTask, pinnedTasksApi.unpin) from the task CRUD hooks
- Milestone: the entire `apps/.../features/tasks/hooks/` layer is now @posthog/ui shims — the tasks-mutation-hooks keystone (cited as the blocker for sidebar/inbox/task-detail/command) is retired
- Bridge: apps task-mutation-bridge.ts + useTasks.ts shim remain until consumers import package paths directly
- Validation: pnpm typecheck 19/19; ui useTaskCrudMutations.test.tsx 2/2; renderer vite build

## 2026-06-02 - suspension-write-hooks

- Moved: `useSuspendTask`/`useRestoreTask` apps `features/suspension/hooks` -> `packages/ui/src/features/suspension` (apps paths are re-export shims)
- Registered: extended `SUSPENSION_CLIENT` (suspend/restore) + new `SuspensionCacheKeyProvider` (host adapter `suspension-cache-keys.ts`, wired in desktop-services)
- Data: source of truth is ws-server suspension service; ui holds the optimistic suspended-id set + drives git working-tree/branch cache invalidation
- Cleaned: removed `@renderer/trpc` + `workspaceApi` + apps gitCacheKeys couplings from the suspension write hooks
- Bridge: apps suspension hook shims remain until consumers (TaskLogsPanel, useTaskContextMenu) import the package paths directly
- Validation: pnpm typecheck 19/19; ui useSuspendTask.test.tsx 2/2; renderer vite build

## 2026-06-02 — ui-sidebar (main tree + task context-menu keystone)

- Moved: `apps/code/.../sidebar/components/{SidebarMenu,SidebarContent,MainSidebar}.tsx` + `apps/code/.../hooks/useTaskContextMenu.ts` -> `packages/ui/src/features/{sidebar/components,tasks}/` (old paths are re-export shims)
- Registered: `TASK_CONTEXT_MENU_CLIENT` (packages/ui/.../tasks/taskContextMenuClient.ts) + desktop adapter `apps/.../platform-adapters/task-context-menu-client.ts` wrapping `trpcClient.contextMenu.show{Task,BulkTask}ContextMenu`, bound in `desktop-services.ts`. Added `BulkTaskContextMenuResult` export to `@posthog/core/context-menu/schemas`
- Data: the native context menu is host transport (port returns the chosen action); the ui `useTaskContextMenu` orchestrates the business actions (rename/pin/suspend/archive/delete) via the already-ported ui task/suspension/archive hooks; workspace lookup via `WORKSPACE_CLIENT.getAll`; external-app via ui `handleExternalAppAction`
- Cleaned: deleted dead app suspension duplicates `useSuspendTask.ts`/`useRestoreTask.ts` (byte-equivalent to the ui versions behind WORKSPACE_CLIENT+SUSPENSION_CLIENT); repointed `TaskLogsPanel` to `@posthog/ui/features/suspension`
- Bridge: app `export *` shims at the 4 ported paths remain until SidebarContent/MainSidebar consumers + command-center import package paths directly
- Validation: @posthog/ui + @posthog/core typecheck 0 (my files); ui sidebar+suspension+tasks vitest 49/49; biome clean. Live bundle smoke deferred (concurrent environments-settings move left the renderer bundle red — exogenous)

## 2026-06-02 - workspace UI tail -> ui (mutation hooks + branch-mismatch dialog)

- Moved: workspace mutation hooks (useCreate/Delete/EnsureWorkspace) -> `@posthog/ui/features/workspace/useWorkspaceMutations`; `useBranchMismatchDialog`(+test) -> `@posthog/ui/features/workspace`
- Registered: WORKSPACE_CLIENT port +create/+delete (TrpcWorkspaceClient adapter); NEW host-set worktrees cache-key provider (`workspaceCacheProvider` + `workspace-cache-keys` adapter, wired in desktop-services); branch-mismatch checkout via existing GIT_WRITE_CLIENT
- Data: source of truth is ws-server WorkspaceService; WORKSPACE_QUERY_KEY (ui-owned) + listGitWorktrees (host-keyed via provider) invalidated coherently on mutate
- Cleaned: removed @renderer/trpc/useTRPC from the workspace UI; only the imperative `workspaceApi` (apps host glue for adapters) stays apps-side
- Bridge: apps shims at `features/workspace/hooks/useWorkspace` (re-exports ui hooks + workspaceApi) + `useBranchMismatchDialog` (consumer TaskLogsPanel) — retire when task-detail consumers move
- Validation: ui workspace vitest 21/21; ui+apps typecheck 0 workspace-attributable; biome 0 restricted imports; renderer vite build ✓

## 2026-06-02 - task-service-bridge (keystone #1 bridge)

- Moved: inbox `useDiscussReport`/`useCreatePrReport` apps -> `packages/ui/features/inbox/hooks` (apps paths re-export shims)
- Registered: `TaskServiceBridge` (`@posthog/ui/features/tasks/taskServiceBridge`, createTask/openTask/resolveDefaultModel) + host impl `platform-adapters/task-service-bridge.ts` (wraps renderer TaskService), wired in main.tsx
- Data: `TaskCreationInput`/`TaskCreationOutput` relocated to `@posthog/shared/task-creation-domain` (Task = domain-types Task); renderer TaskCreationSaga re-exports them
- Cleaned: inbox direct-create hooks no longer depend on the renderer TaskService (keystone #1) — they call the bridge
- Bridge: apps task-service-bridge.ts + inbox hook shims remain until the TaskCreationSaga itself lands in core
- Validation: pnpm typecheck 19/19; ui useDiscussReport.test.tsx 2/2; renderer vite build

## 2026-06-02 — sessions (conversation-rendering tier -> ui)

- Moved: `apps/code/.../features/sessions/components/{buildConversationItems.ts, mergeConversationItems.ts, session-update/{SessionUpdateView,ToolCallBlock,SubagentToolView}.tsx}` + `utils/extractSearchableText.ts` (~1210L) -> `packages/ui/src/features/sessions/` (old paths are `export *` shims). Colocated tests git-mv'd to ui.
- Registered: `mcpToolBlockSlot.ts` (set/getMcpToolBlock) in ui; host `apps/.../features/sessions/mcpToolBlockHost.ts` registers the app `McpToolBlock` at boot (side-effect import in main.tsx). `ToolCallBlock` renders the slot, falling back to `ToolCallView` when unset.
- Data: the conversation model (`ConversationItem`/`RenderItem`) and its update-rendering are now host-agnostic ui; the live-agent `SessionService` (3848L, host connections) is untouched and still owns event ingestion
- Cleaned: `@posthog/agent` root import -> browser-safe `/acp-extensions` subpath (ui biome rule); `@shared/types/session-events` -> `@posthog/shared`
- Bridge: `McpToolBlock` stays in apps (iframe MCP-app host + `mcpApps` trpc) behind the slot; app `export *` shims remain until `ConversationView`/`SessionView` consume the package paths directly
- Validation: ui+apps typecheck 0 (my files); ui sessions vitest 99/99 (+21 moved); biome clean. Bundle smoke deferred (concurrent task-detail FileTreePanel move left the renderer red — exogenous)

## 2026-06-02 - settings worktrees + WorkspacesSettings -> ui

- Moved: settings worktrees subtree (WorktreeSize/Row/GroupSection/WorktreesSettings) + WorkspacesSettings -> `@posthog/ui/features/settings/sections`; useSuspensionSettings -> `@posthog/ui/features/suspension`
- Registered: WORKSPACE_CLIENT +getWorktreeSize/listGitWorktrees/deleteWorktree/confirmDeleteWorktree + worktreesQueryKey provider; SUSPENSION_CLIENT +getSettings/updateSettings; NEW SETTINGS_WORKSPACES_PORT (+ RendererSettingsWorkspacesClient adapter, bound in desktop-services)
- Data: worktrees read keyed by host-provided worktreesQueryKey (coherent with worktreesFilter invalidation); default-directories list on a ui-owned key (sole react-query consumer)
- Bridge: apps shims at WorktreesSettings + WorkspacesSettings (consumer SettingsDialog) — retire when SettingsDialog moves
- Validation: ui workspace+suspension+settings vitest 34/34; ui+apps typecheck 0; biome 0 restricted imports; renderer vite build ✓

## 2026-06-02 - workspace boot subscriptions -> WorkspaceEventsContribution

- Moved: App.tsx inline workspace.onError/onPromoted/onBranchChanged/onLinkedBranchChanged listeners -> `@posthog/ui/features/workspace/workspace-events.contribution` (started by startWorkbench via workspaceUiModule)
- Registered: WORKSPACE_CLIENT +onError/onPromoted/onBranchChanged/onLinkedBranchChanged (TrpcWorkspaceClient adapter); workspace.module.ts binds WORKBENCH_CONTRIBUTION
- Data: host workspace events invalidate WORKSPACE_QUERY_KEY (shared key) so all workspace readers stay in sync; promote/error surface toasts
- Validation: contribution test 4/4; ui+apps typecheck 0; renderer vite build ✓ 13.4s

## 2026-06-02 - sessions-service-bridge

- Registered: `SESSION_SERVICE` bridge (`@posthog/ui/features/sessions/sessionServiceBridge`, 13 methods: sendPrompt/config x2/permission x2/cancel/clear/reset/handoffToCloud/retryCloudTaskWatch/retryUnhealthy/shell-exec x2) + host impl `platform-adapters/session-service-bridge.ts` delegating to `getSessionService()`, wired in main.tsx
- Added: `ShellClient.execute()` (one-shot `trpcClient.shell.execute`) to the existing terminal ShellClient port
- Moved: `ModelSelector` + `useSessionCallbacks` -> `@posthog/ui/features/sessions/*` (apps paths re-export shims)
- Cleaned: 2 more `getSessionService()` UI consumers decoupled from the renderer service; this is the keystone-#1 (SessionService) contract the prior notes flagged as the unblock
- Bridge: apps session-service-bridge.ts + shims remain until SessionService is dismantled into core/ws-server
- Validation: ui sessions vitest 14 files / 112 tests; typecheck + biome clean on touched paths

## 2026-06-02 — focus + agent boot events

- Moved: `App.tsx` inline `focus.onBranchRenamed`/`focus.onForeignBranchCheckout`/`agent.onAgentFileActivity` subscriptions -> `FocusEventsContribution` + `AgentEventsContribution` (packages/ui/features/{focus,agent})
- Registered: `FOCUS_EVENTS_CLIENT` + `AGENT_EVENTS_CLIENT` ports; desktop adapters bound in desktop-services; `focusUiModule`/`agentUiModule` in desktop-contributions
- Cleaned: App.tsx no longer registers any workspace/focus/agent subscriptions inline (all three clusters now WORKBENCH_CONTRIBUTIONs); orphaned imports removed
- Validation: ui + apps typecheck clean in touched files; biome lint 0 noRestrictedImports

## 2026-06-02 — secure-store (router -> backing service)

- Moved: inline router logic in `apps/code/.../trpc/routers/secure-store.ts` (encrypt/decrypt + electron-store + try/catch) -> new `apps/code/.../services/secure-store/{service.ts,schemas.ts}` `SecureStoreService`
- Registered: `MAIN_TOKENS.SecureStoreService` (`.to(SecureStoreService)`) + `MAIN_TOKENS.SecureStoreBackend` (`.toConstantValue(rendererStore)`); router now one-line zod-validated forwards
- Data: encrypted-at-rest KV store; values machine-key encrypted before touching the backend (never plaintext at rest). SecureStoreBackend is a minimal has/get/set/delete/clear interface so the service is Electron-free and unit-testable
- Cleaned: removed the "tRPC router with no backing service" + "inline business logic in router" forbidden patterns for secure-store
- Validation: apps typecheck 0; service.test.ts 5/5 (node, real crypto + fake backend); biome clean

## 2026-06-02 - sessions cloudRunOptions -> ui (pure-leaf extraction)

- Moved: getCloudPrAuthorshipMode/getCloudRunSource/getCloudRuntimeOptions out of the renderer SessionService -> `@posthog/ui/features/sessions/cloudRunOptions` (pure derivations; +test 7/7)
- Data: cloud-run-source / pr-authorship-mode / runtime options derived from host run-state + session config; service keeps the I/O
- Validation: ui sessions vitest 119/119; ui+apps typecheck 0; renderer vite build ✓ 13.5s

## 2026-06-02 - sessions main view tree -> ui

- Added: neutral `diffWorkerHost` (`@posthog/ui/workbench/diffWorkerHost`) for the pierre diff Vite worker; reviewHostBindings registers it alongside the review-specific one
- Moved: `useConversationSearch`, `ConversationView` (361L), `SessionView` (716L) -> `@posthog/ui/features/sessions/*` (apps paths are re-export shims)
- Cleaned: ConversationView's `?worker&url` host coupling now flows through the worker host; SessionView's 5 SessionService calls through the SESSION_SERVICE bridge
- Bridge: apps shims remain until the stateful SessionService is dismantled; useSessionConnection still needs `loadLogsOnly`/`watchCloudTask` added to the bridge
- Validation: ui sessions vitest 15 files / 119 tests; typecheck + biome clean on touched paths

## 2026-06-02 — additional-directories (router -> service, repo-bypass removed)

- Moved: direct repository access in `apps/code/.../trpc/routers/additional-directories.ts` -> new `packages/workspace-server/src/services/additional-directories/` `AdditionalDirectoriesService`
- Registered: `ADDITIONAL_DIRECTORIES_SERVICE` identifier + `additionalDirectoriesModule`; loaded in the apps container (shares the bound `WORKSPACE_REPOSITORY` + `DEFAULT_ADDITIONAL_DIRECTORY_REPOSITORY`)
- Data: the service injects both repos via their ws-server identifiers and owns default (per-device) + per-task additional directories; router is one-line zod-validated forwards
- Cleaned: removed the "router bypasses service to repository" forbidden pattern for additional-directories
- Validation: ws-server typecheck 0 + additional-directories.test.ts 2/2 (fake repos, plain node); apps typecheck 0 (my files); biome clean

## 2026-06-02 - task-detail leaves -> ui (TaskPendingView / SuggestedTasksPanel / WorkspaceSetupPrompt)

- Moved: TaskPendingView, SuggestedTasksPanel, WorkspaceSetupPrompt -> `@posthog/ui/features/task-detail/components`
- Registered: WorkspaceSetupPrompt consumes existing FOLDERS_CLIENT.addFolder + GIT_QUERY_CLIENT.detectRepo + useEnsureWorkspace (no new ports)
- Bridge: apps shims at old paths (consumers MainLayout/TaskInput/TaskLogsPanel) — retire when those move
- Validation: ui task-detail vitest 20/20; ui+apps typecheck 0; renderer vite build ✓ 14s

## 2026-06-02 - command-center data hooks + leaf components -> ui

- Moved: useCommandCenterData/useAutofillCommandCenter/useAvailableTasks (hooks) + TaskSelector/CommandCenterPRButton (components) -> `@posthog/ui/features/command-center`
- Data: all consume existing ui hooks/stores (tasks/workspaces/archive/sessions/commandCenterStore) + git-interaction PR hooks; no new ports
- Bridge: apps shims at old paths (consumers CommandCenterGrid/View/Panel) — retire when the Panel/Toolbar keystone tier moves
- Validation: ui command-center vitest 6/6; ui+apps typecheck 0; renderer vite build ✓ 13.4s

## 2026-06-02 - sessions UI surface decoupled from SessionService

- Extended `SESSION_SERVICE` bridge: +connectToTask/loadLogsOnly/watchCloudTask/recordActivity (+ ConnectParams type)
- Moved: `useSessionConnection` -> `@posthog/ui/features/sessions/hooks` (apps shim)
- Decoupled: `CommandCenterToolbar` cancelPrompt -> bridge (stays in apps/command-center)
- MILESTONE: no renderer UI calls `getSessionService()`; the SessionService is reachable from ui only through the bridges. Remaining direct callers are the bridge adapters, the singleton + tests, and apps-layer orchestration (task-creation saga, localHandoffService, GlobalEventHandlers, desktop-services)
- Validation: ui sessions vitest 15 files / 119 tests; typecheck + biome clean on touched paths

## 2026-06-02 - panels feature -> ui (cascade) + TaskLogsPanel/TabContentRenderer

- Moved: TaskLogsPanel, TabContentRenderer (task-detail) + usePanelLayoutHooks, PanelLayout, LeafNodeRenderer (panels) -> @posthog/ui
- Cleaned: apps/panels reduced to index.ts re-export; PanelLayout/usePanelLayoutHooks no longer in apps (ui-panels acceptance)
- Bridge: apps shims at TaskLogsPanel/TabContentRenderer (consumers in task-detail) — retire when TaskDetail moves
- Validation: ui panels+task-detail vitest 62/62; ui+apps typecheck 0; renderer vite build ✓ 13.8s

## 2026-06-02 — encryption (router -> service)

- Moved: inline router logic in `apps/code/.../trpc/routers/encryption.ts` (isAvailable + base64 + passthrough fallback + error handling) -> new `apps/code/.../services/encryption/service.ts` `EncryptionService`
- Registered: `MAIN_TOKENS.EncryptionService` (`.to(EncryptionService)`, injects platform `SECURE_STORAGE_SERVICE`); router is one-line zod forwards
- Cleaned: removed "tRPC router with inline business logic" forbidden pattern for encryption
- Validation: service.test.ts 3/3 (fake ISecureStorage); apps typecheck 0 (my files); biome clean

## 2026-06-02 - ui-settings billing chain

- Moved: `useSpendAnalysis`, `TokenSpendAnalysisBanner` (393L), `PlanUsageSettings` (509L) -> `@posthog/ui` (apps paths are re-export shims)
- Cleaned: imperative `getAuthenticatedClient` -> `useOptionalAuthenticatedClient`; `UsageBucket` sourced from `@posthog/core/usage/schemas` (ui may import core) instead of `@main/*`
- Validation: ui billing vitest 4 files / 53 tests; typecheck + biome clean on touched paths

## 2026-06-02 - TaskDetail screen -> ui + FILE_WATCHER_CONTROL port

- Moved: TaskDetail.tsx (main task-detail screen) -> @posthog/ui/features/task-detail/components; apps @hooks/useFileWatcher orchestration -> @posthog/ui/features/file-watcher/useRepoFileWatcher
- Registered: NEW FILE_WATCHER_CONTROL port (start/stop) + TrpcFileWatcherControl adapter (desktop-services); fs-read invalidation via fsQueryKey provider
- Cleaned: deleted obsolete apps @hooks/useFileWatcher (host trpc now behind the port)
- Bridge: apps TaskDetail shim (consumer MainLayout) — retire when MainLayout moves
- Validation: ui task-detail+file-watcher vitest 20/20; ui+apps typecheck 0; renderer vite build ✓ 13.25s

## 2026-06-02 - command-center (ui-command leaf)
- Moved: `apps/code/src/renderer/features/command-center/components/CommandCenterSessionView.tsx` -> `packages/ui/src/features/command-center/components/CommandCenterSessionView.tsx`
- Data: pure UI; renders ui SessionView driven by useSessionViewState/useSessionConnection/useSessionCallbacks (all ui)
- Bridge: apps path is a re-export shim; remains until CommandCenterPanel/Grid/View land (gated on task-detail `TaskInput`)
- Validation: `@posthog/ui` + `@posthog/code` typecheck 0; biome clean

## 2026-06-02 - sessions (core split: model relocation + core seam)

- Moved: session domain model `apps`/`@posthog/ui` sessionStore types -> `@posthog/shared/src/sessions.ts` (`AgentSession`, `Adapter`, `QueuedMessage`, `OptimisticItem`, `PermissionRequest`, `SessionStatus`, config-option helpers); ui `sessionStore.ts`/`sessionLogTypes.ts` re-export from shared.
- Moved: pure connect-orchestration decisions out of the renderer `SessionService.doConnect` -> `@posthog/core/sessions/connectRouting.ts` (`routeLocalConnect`, `computeAutoRetryFinalState`).
- Data: source of truth for the session model is now `@posthog/shared`; `@posthog/ui` sessionStore is the single runtime store (the divergent apps `stores/sessionStore.ts` duplicate was deleted).
- Cleaned: removed the apps↔ui sessionStore divergence (one model, one store); core now consumes the model directly, enabling future core-owned session orchestration.
- Bridge: `apps/.../platform-adapters/session-service-bridge.ts` (SESSION_SERVICE) remains the seam until the stateful `SessionService` body is split into a core SessionService + ws-server host I/O.
- Validation: `pnpm typecheck` 19/19; renderer `vite build`; core 8/8; ui session 39/39; apps service.test 101/103 (2 pre-existing exogenous cloud-file-reader fails).
- Known: `@posthog/shared` has two divergent `Task` interfaces (`task.ts` vs `domain-types.ts`) — needs a dedicated reconcile slice.

## 2026-06-02 - task-detail TaskInput keystone + ui-command cascade
- Moved: `apps/.../task-detail/components/TaskInput.tsx` + `hooks/{usePreviewConfig,useTaskCreation}.ts` -> `packages/ui/src/features/task-detail/`
- Moved: `apps/.../command-center/components/{CommandCenterPanel,CommandCenterGrid,CommandCenterView}.tsx` -> `packages/ui/src/features/command-center/components/`; `useAutofillCommandCenter.test.ts` -> ui
- Registered: `PREVIEW_CONFIG_CLIENT` (packages/ui/features/task-detail/previewConfigClient.ts) + `TrpcPreviewConfigClient` adapter bound in desktop-services; added `FOLDERS_CLIENT.getMostRecentlyAccessedRepository`, `WORKSPACE_CLIENT.getWorktreeFileUsage`
- Data: task creation routes through `getTaskServiceBridge()` (keystone-#1 bridge) instead of `get(RENDERER_TOKENS.TaskService)`; preview config + skills + recent-repo + worktree-usage via per-feature client ports
- Cleaned: removed 6 dead apps command-center shims; apps command-center dir now empty (fully ui-resident)
- Bridge: apps `task-detail/components/TaskInput.tsx` is a re-export shim (consumers MainLayout + the now-ui CommandCenterPanel). Retire when MainLayout's task-input view moves (ui-shell/ui-task-detail).
- Validation: @posthog/ui typecheck 0; @posthog/code typecheck 0 in these paths (tree red is exogenous: concurrent sessions/settings/inbox agents); renderer vite build ✓; ui command-center + task-detail vitest green; biome clean

## 2026-06-02 - git-interaction (slice code-complete)

- Moved: `apps/code/.../features/git-interaction/components/CloudGitInteractionHeader.tsx` -> `packages/ui/src/features/git-interaction/components/` (last real app file)
- Registered: `LocalHandoffBridge` (`packages/ui/src/features/sessions/localHandoffBridge.ts`); host wires `setLocalHandoffBridge(getLocalHandoffService())` in `apps/code/.../platform-adapters/session-service-bridge.ts`
- Cleaned: retired all 14 git-interaction re-export shims (components/hooks/utils); repointed last consumers (`HeaderRow`, `focusClientAdapter`, `GitInteractionDialogs.stories`) to `@posthog/ui`. apps/code git-interaction now holds only the 2 app-only `*.stories.tsx`.
- Data: source of truth is the git capability in workspace-server (via GIT_QUERY_CLIENT/GIT_WRITE_CLIENT ports); UI is a pure projection
- Bridge: `LocalHandoffBridge` (apps->ui) remains until `LocalHandoffService` (trpc.folders/os + getSessionService) moves to core/ws-server — a sessions-slice concern
- Validation: apps web+node tsc 0; @posthog/ui typecheck 0; ui git-interaction vitest 76/76; renderer `vite build` ✓. Remaining gate: live-GUI stage/commit/switch smoke (needs running Electron; not headless-runnable here)

## 2026-06-02 - inbox feature -> packages/ui (ui-inbox code-complete)
- Moved: `apps/.../features/inbox/{components/InboxView,InboxSignalsTab,InboxSetupPane,InboxSourcesDialog, components/detail/ReportDetailPane,ReportTaskLogs, hooks/useInboxDeepLink,useInboxDeepLinkListSync, stores/inboxCloudTaskStore}` -> `packages/ui/src/features/inbox/`
- Registered: `DEEP_LINK_CLIENT.getPendingReportLink` + `onOpenReport` (port + deep-link adapter)
- Data: inbox report reads via ported ui hooks; cloud-task creation + default-model via `getTaskServiceBridge()` (createTask/resolveDefaultModel); deep links via `DEEP_LINK_CLIENT`; folders recent-repo via `FOLDERS_CLIENT`
- Cleaned: fixed the SignalSourcesSettings module-not-found red (repointed inbox setup/sources to `@posthog/ui/features/settings/sections`)
- Bridge: apps `inbox/components/InboxView.tsx` + `inbox/hooks/useInboxDeepLink.ts` are re-export shims (consumer MainLayout). Host-stays (by design): `inbox/utils/resolveDefaultModel.ts` (task-service-bridge impl), `inbox/devtools/inboxDemoConsole.ts` (dev console).
- Validation: @posthog/ui typecheck 0; @posthog/code typecheck 0 inbox errors; renderer vite build OK; ui inbox vitest 78/78

## 2026-06-02 - sessions (god-object SessionService -> core)

- Moved: the entire ~3650-line renderer `SessionService` -> `@posthog/core/sessions/sessionService.ts`, behind an injected host-agnostic `SessionServiceDeps` (tRPC port, store port, helper ports, auth/notifier/analytics/toast/log/queryClient/persistedConfig).
- Adapter: `apps/.../sessions/service/service.ts` is now a thin desktop host adapter (`buildSessionServiceDeps()` + `getSessionService()`), wiring `trpcClient` + `@posthog/ui` stores + host helpers; re-exports `SessionService` + `ConnectParams`.
- Data: orchestration is now host-agnostic core; host I/O is injected via ports (tRPC -> main process, stores -> `@posthog/ui`). `Task`/`ConnectParams` use `@posthog/shared/domain-types` (the app's live Task shape).
- Cleaned: the canonical "renderer service owns all the orchestration" forbidden pattern is removed — the renderer no longer contains the SessionService logic, only the singleton + deps wiring.
- Bridge: `platform-adapters/session-service-bridge.ts` (SESSION_SERVICE) + `sessionTaskBridgeAdapter.ts` remain in apps by design (host wiring); `getSessionService()` singleton stays in the adapter.
- Validation: `@posthog/core` + apps typecheck 0 (my paths); `service.test.ts` 101/103 (identical pre/post-move; 2 exogenous cloud-file-reader fails); biome clean. Live agent-turn smoke pending (can't run headless) -> slice `needs_validation`.

## 2026-06-02 - ui-shell layout + boot architecture (ui-shell -> needs_validation)
- Moved: `apps/.../components/{HeaderRow,MainLayout}.tsx` -> `packages/ui/src/workbench/`
- Registered: `WORKSPACE_CLIENT.reconcileCloudWorkspaces` (port + adapter); host `AnalyticsBootContribution` + `InboxDemoDevContribution` (apps/.../contributions/app-boot.contributions.ts) bound in desktop-contributions
- Data: MainLayout cloud-reconcile via WORKSPACE_CLIENT; analytics-init + dev-inbox-console now WORKBENCH_CONTRIBUTIONs (App.tsx has zero inline initializers)
- Cleaned: lifted GlobalEventHandlers (host glue) out of MainLayout to the App root; deleted dead HeaderRow apps shim
- Bridge/host-stays (correct end-state): App.tsx (auth-gate root), GlobalEventHandlers, Providers, main.tsx, ErrorBoundary wrapper. apps MainLayout.tsx is a shim (consumer App).
- Outstanding: live Electron boot smoke; acceptance #4 (TanStack route contributions) doesn't match the navigationStore view-switch routing model — flagged for re-scoping.
- Validation: @posthog/ui typecheck 0; @posthog/code typecheck 0 (modulo exogenous service.ts); renderer vite build OK; biome clean

## 2026-06-02 - ui-sidebar drained (-> needs_validation)
- Moved: `apps/.../sidebar/hooks/useTaskPrStatus.test.ts` -> `packages/ui/src/features/sidebar/useTaskPrStatus.test.ts` (mock repointed @renderer/trpc -> @posthog/di/react useService)
- Deleted: `apps/.../features/panels/index.ts` (dead re-export barrel, zero consumers)
- Result: apps features/{sidebar,right-sidebar,panels} have zero real files; all ui-resident
- Validation: ui + apps typecheck 0; ui useTaskPrStatus test 8/8; renderer vite build OK; biome clean

## 2026-06-03 - retire session/task bridges (cleanup)
- Moved: nothing new; this collapses three module-setter bridges now that consumers resolve real services via DI.
- Registered: consumers use `useService(SESSION_SERVICE|TASK_SERVICE|PREVIEW_CONFIG_CLIENT)` (React) and `resolveService(SESSION_SERVICE)` (imperative) directly; no bridge indirection.
- Cleaned:
  - Deleted bridges `packages/ui/.../sessions/sessionServiceBridge.ts`, `sessions/sessionTaskBridge.ts`, `tasks/taskServiceBridge.ts` and the `sessionServiceBridge.test.ts` (it only covered the deleted setX/getX singleton — 2 tests removed, no real coverage lost).
  - Deleted apps adapters `platform-adapters/task-service-bridge.ts` and `features/sessions/sessionTaskBridgeAdapter.ts` (sole purpose was setX wiring); removed their boot imports from `renderer/main.tsx`.
  - Stripped the `sessionServiceBridge` object + `setSessionServiceBridge` wiring (and now-unused imports) from `platform-adapters/session-service-bridge.ts`; the file now only registers `LocalHandoffBridge` (that bridge stays).
  - Repointed 5 affected test files off the dead bridge `vi.mock`s onto `@posthog/di/react` `useService` / `@posthog/di/container` `resolveService` mocks (useTaskMutations, useChatTitleGenerator, useTaskDeepLink, useArchiveTask, useDiscussReport) plus taskCreationSaga.
- Bridges left intact by design: `getArchiveTaskBridge`, `getTaskMutationBridge`, `getLocalHandoffBridge`.
- Validation: `@posthog/core`/`@posthog/ui`/`@posthog/code` typecheck 0; ui vitest `sessions tasks task-detail inbox archive command-center` 910/910 (was 891 pass / 21 fail before repointing the test mocks); biome clean on all touched files (broader tree has unrelated exogenous errors from other in-flight agents).

## 2026-06-03 - retire LocalHandoffBridge (cleanup)
- Moved: nothing new; `LocalHandoffService` already lives in `packages/ui/.../sessions/localHandoffService.ts` bound to `LOCAL_HANDOFF_SERVICE` in the renderer DI container.
- Repointed: `CloudGitInteractionHeader.tsx` now resolves the service via `useService<LocalHandoffService>(LOCAL_HANDOFF_SERVICE)` instead of `getLocalHandoffBridge()`; all five method calls (start/resumePending/openConfirm/cancelPendingFlow/hideDirtyTree) are identical on the ported service.
- Cleaned:
  - Deleted bridge `packages/ui/.../sessions/localHandoffBridge.ts` (setX/getX module-setter, sole consumer was CloudGitInteractionHeader).
  - Deleted the unported apps service `apps/.../features/sessions/service/localHandoffService.ts` (superseded by the ui service + `getLocalHandoffHost` port).
  - Deleted apps adapter `platform-adapters/session-service-bridge.ts` (its sole remaining job was the LocalHandoffBridge setX wiring) and removed its boot import from `renderer/main.tsx`.
- No bridge tests existed for localHandoff; nothing to repoint.
- Validation: `@posthog/core`/`@posthog/ui`/`@posthog/code` typecheck 0 (my paths); biome clean on touched files; ui vitest `sessions git-interaction` reported below.

## 2026-06-03 - retire task-mutation & archive-task bridges (cleanup)
- Moved: nothing new; consumers `useDeleteTask`/`useCreateTask` (`tasks/useTaskCrudMutations.ts`) and `archiveTaskImperative`/`useArchiveTask` (`archive/useArchiveTask.ts`) already resolve real DI: `useService<WorkspaceClient>(WORKSPACE_CLIENT)` / `resolveService(WORKSPACE_CLIENT)`, `useHostTRPCClient().contextMenu.confirmDeleteTask`, `resolveService(ARCHIVE_CLIENT).archive`, `resolveService(SESSION_SERVICE).disconnectFromTask`, and `pinnedTasksApi`.
- Cleaned:
  - Deleted bridges `packages/ui/.../tasks/taskMutationBridge.ts`, `packages/ui/.../archive/archiveTaskBridge.ts` (setX/getX module-setters with no remaining `getX` consumers).
  - Deleted apps adapters `platform-adapters/task-mutation-bridge.ts`, `platform-adapters/archive-task-bridge.ts` (sole purpose was setX wiring); removed their two side-effect boot imports from `renderer/main.tsx`.
  - Repointed `tasks/useTaskCrudMutations.test.tsx` and `archive/useArchiveTask.test.ts` off the dead bridge `vi.mock`s onto the real ports: `@posthog/di/react` `useService`, `@posthog/di/container` `resolveService` (routed by token), `@posthog/host-router/react` `useHostTRPCClient`, and `@posthog/ui/features/sidebar/taskMetaApi` `pinnedTasksApi`. Coverage preserved (confirm/decline delete paths; optimistic-add + rollback/re-pin archive paths).
- Left intact by design: apps imperative `workspaceApi` (`features/workspace/hooks/useWorkspace.ts`) — not a bridge, has 4 other apps-internal consumers.
- Validation: see structured report.

## 2026-06-03 - retire 6 ready useService ports (useHostTRPC migration)
- Context: every real consumer of these ports already calls `useHostTRPC`/`useHostTRPCClient` against the host-router; only the dead port interface + adapter + DI binding remained. Retired the scaffolding.
- Retired ports/tokens: `ARCHIVE_CLIENT`, `AUTH_CLIENT`, `FILE_CONTEXT_MENU_CLIENT`, `PANEL_CONTEXT_MENU_CLIENT`, `SETTINGS_GENERAL_PORT`, `TASK_CONTEXT_MENU_CLIENT`.
- Deleted (ui): `features/archive/ports.ts`, `features/archive/archiveCacheProvider.ts`, `features/sessions/fileContextMenuClient.ts`, `features/panels/panelContextMenuClient.ts`, `features/tasks/taskContextMenuClient.ts`.
- Deleted (apps): `platform-adapters/{archive-client,archive-cache-keys,file-context-menu-client,panel-context-menu-client,task-context-menu-client,settings-general-client}.ts`. `auth-client.ts` was already removed (token no longer existed; `auth/ports.ts` keeps only `AUTH_SIDE_EFFECTS`).
- Edited (not deleted): `features/settings/ports.ts` — stripped `SettingsGeneralPort`/`SETTINGS_GENERAL_PORT` only; `SettingsWorkspacesPort`/`SETTINGS_WORKSPACES_PORT` stay (blocked port, still bound).
- Repointed:
  - `archive/useArchiveTask.ts`: replaced the `archiveCacheProvider` host-set cache-key indirection with a `useArchiveCacheKeys()` hook that derives the real keys off `useHostTRPC()` (`trpc.archive.{archivedTaskIds,list}.queryKey()`, `trpc.archive.pathFilter().queryKey`); `archiveTaskImperative`/`archiveTasksImperative` now take an `ArchiveCacheKeys` param. `SidebarMenu.tsx` derives keys via the hook and threads them into the two `archiveTasksImperative` calls.
  - `sessions/components/useFileContextMenu.ts`: inlined the `OpenFileContextMenuInput` type (its sole non-adapter consumer) so the dead `fileContextMenuClient.ts` could be deleted.
  - `apps/.../features/auth/hooks/authQueries.ts`: dropped a stale PORT NOTE referencing the retired `AUTH_CLIENT`.
- Cleaned (apps `renderer/desktop-services.ts`): removed the 5 port imports, 5 adapter imports, the `setArchiveCacheKeys(...)` boot call, and the 5 container bindings.
- Tests: rewrote `archive/useArchiveTask.test.ts` — dropped the `./ports`(ARCHIVE_CLIENT) + `archiveCacheProvider` mocks; now mocks `@posthog/host-router/client` `HOST_TRPC_CLIENT` (routed through `resolveService` to `{ archive: { archive: { mutate } } }`), passes `ArchiveCacheKeys` as a param, and asserts `mutate({ taskId })`. Coverage preserved (optimistic add + rollback/re-pin). This test was already red in-tree (consumer had moved to `HOST_TRPC_CLIENT` but the test still mocked the old token); now green.
- Validation: `@posthog/ui` typecheck 0; `@posthog/code` typecheck 0; biome clean on all touched files; `@posthog/ui` test 910/910.

## 2026-06-03 - retire 14 useService ports (useHostTRPC migration, wave 2)
- Context: every real consumer already calls `useHostTRPC`/`useHostTRPCClient` against the host-router; only the dead port interface + adapter + DI binding remained. Retired the scaffolding.
- Retired tokens: `AGENT_EVENTS_CLIENT`, `FILE_CONTENT_CLIENT`, `FOCUS_EVENTS_CLIENT`, `GIT_QUERY_CLIENT`, `GIT_WRITE_CLIENT`, `GITHUB_INTEGRATION_CLIENT`, `LINEAR_INTEGRATION_CLIENT`, `PREVIEW_CONFIG_CLIENT`, `REPO_FILES_CLIENT`, `REVIEW_FILE_CLIENT`, `SETTINGS_WORKSPACES_PORT`, `SIDEBAR_TASK_META_CLIENT`, `SLACK_INTEGRATION_CLIENT`, `WORKSPACE_CLIENT`.
- Deleted whole (ui port files, all tokens retired): `features/agent/agentEventsClient.ts`, `features/focus/focusEventsClient.ts`, `features/code-editor/ports.ts`, `features/code-review/ports.ts`, `features/repo-files/ports.ts`, `features/task-detail/previewConfigClient.ts`, `features/integrations/ports.ts` (github+slack+linear trio), `features/settings/ports.ts` (sole token SETTINGS_WORKSPACES_PORT), `features/workspace/workspaceCacheProvider.ts` (its only live consumer WorktreesSettings now derives keys off `useHostTRPC().workspace.listGitWorktrees.queryKey/queryFilter`).
- Stripped (ui port files with shared survivors): `features/git-interaction/ports.ts` — removed `GitQueryClient`/`GitWriteClient` + `GIT_QUERY_CLIENT`/`GIT_WRITE_CLIENT` + now-unused `GithubRef`/`PrActionType`/`PrReviewThread`/`GitBusyState` imports; kept all git domain types (GitStateSnapshot/CreatePrStep/CommitResult/...PrDetails) still consumed across the git tier. `features/sidebar/ports.ts` — removed `SidebarTaskMetaClient` + `SIDEBAR_TASK_META_CLIENT`; kept `SidebarPrState`/`TaskPrStatus`/`RawTaskTimestamp`. `features/workspace/ports.ts` — removed `WorkspaceClient`/`WORKSPACE_CLIENT` + adapter-only types `CreateWorkspaceInput`/`GitWorktreeEntry`/`WorkspaceWarning`; kept `WORKSPACE_QUERY_KEY`.
- Deleted (apps adapters): `platform-adapters/{agent-events-client,focus-events-client,file-content-client,review-file-client,repo-files-client,preview-config-client,github-integration-client,slack-integration-client,linear-integration-client,settings-workspaces-client,sidebar-task-meta-client,workspace-client,git-query-client,git-write-client,workspace-cache-keys}.ts`.
- Repointed (ui): `git-interaction/utils/branchCreation.ts` + `useGitInteraction.ts` + `task-detail/components/TaskInput.tsx` dropped the `GitWriteClient` type (branchCreation now takes a local structural `BranchCreator`; TaskInput memoizes its inline createBranch client). `WorktreesSettings.tsx` derives the worktrees query key/filter off `useHostTRPC()`.
- Cleaned (apps `renderer/desktop-services.ts`): removed all 14 port imports + 14 adapter imports + the `setWorkspaceCacheKeyProvider(...)` boot call + the 14 container bindings (kept `setGitCacheKeyProvider` + the git-cache-keys adapter — shared git working-tree/branch invalidation infra still consumed by the git/code-review/file-watcher tiers — and `setTaskMetaApi`, taskMetaApi survives). Dropped stale PORT NOTE comments in `apps/.../features/workspace/hooks/useWorkspace.ts` and `features/sidebar/taskMetaApi.ts`.
- Tests: repointed 7 test files off the retired-port `vi.mock("@posthog/di/react")`/`workspaceCacheProvider` mocks onto `useHostTRPC`/`useHostTRPCClient` mocks: useTaskPrStatus, BranchSelector, useBranchMismatchDialog, branchCreation, useWorkspaceMutations, useSuspendTask, useDiscussReport, plus workspace-events.contribution (host-router subscription shape). Coverage preserved; these were already red in-tree (consumers had migrated). Full ui suite 96 files / 910 tests pass (was 879 pass / 31 fail).
- Validation: `@posthog/host-router`/`@posthog/core`/`@posthog/ui`/`@posthog/code` typecheck 0; biome clean on all touched files; `@posthog/ui` test 910/910.

## 2026-06-03 - opus-handoff-syscalls - handoff host syscalls -> workspace-server (acceptance #2)
- Context: the handoff orchestration sagas already live in `@posthog/core/handoff`, but the apps `HandoffService` deps-provider still performed raw host syscalls (`node:fs` on `~/.posthog-code/sessions/<runId>/logs.ndjson` + `@posthog/git` stash/reset sagas). Moved those into workspace-server so the deps-provider is pure wiring.
- FS -> ws-server `LocalLogsService` (`packages/workspace-server/src/services/local-logs/service.ts`): added `seedLocalLogs`/`countLocalLogEntries`/`deleteLocalLogCache`, reusing its existing `getLocalLogPath` so the NDJSON path is owned in one place. Exposed as `localLogs.seed` (mutation) / `localLogs.count` (query) / `localLogs.delete` (mutation) in `trpc.ts`. Main thin-client (`apps/code/src/main/services/local-logs/service.ts`) gained 3 delegating methods; its PORT NOTE's "handoff stops writing the NDJSON via raw fs" retirement clause is now satisfied.
- GIT -> ws-server `GitService` (`packages/workspace-server/src/services/git/service.ts`): added `readHandoffLocalGitState` (wraps `@posthog/git/handoff`) + `cleanupAfterCloudHandoff` (StashPushSaga + ResetToDefaultBranchSaga, returns `{stashed,switched,defaultBranch}`). Exposed as `git.readHandoffLocalGitState` (query) + `git.cleanupAfterCloudHandoff` (mutation). `handoffLocalGitStateSchema` mirrored locally in ws git `schemas.ts` (ws zod v4; nullable strings; structurally assignable to `AgentTypes.HandoffLocalGitState`).
- `HandoffService`: now injects `MAIN_TOKENS.LocalLogsService` + `MAIN_TOKENS.WorkspaceClient` and delegates; dropped all `node:fs`/`node:os`/`node:path` imports and the `@posthog/git` runtime imports (`readHandoffLocalGitState`/`StashPushSaga`/`ResetToDefaultBranchSaga`) — only a type-only `GitHandoffBranchDivergence` import remains. The cloud-log `fetch` stays in the provider (network, not a host syscall); only the fs write/read/rm moved.
- Core: `HandoffToCloudSagaDeps.countLocalLogEntries` changed `number -> Promise<number>` (now an async tRPC call); saga awaits it; test mocks updated to `mockResolvedValue`.
- Validation: full `pnpm typecheck` 21/21; ws-server `local-logs` 17/17 (added seed/count/delete tests); `@posthog/core` handoff 16/16; apps `handoff/service.test` 6/6 (constructor +2 args; `localGitState` now driven via the `workspaceClient.git` mock); core purity gate `biome lint packages/core/src/handoff` 0 noRestrictedImports; biome check clean. ws-server consumed from src (no dist build). NOT run: live end-to-end handoff GUI smoke (real cloud run + GitHub auth + Electron; env-gated headless) — the sole remaining gate before `handoff` flips to passing.

## 2026-06-03 - opus-handoff-syscalls - HandoffService fully out of apps/code (core + workspace-server)
- Follow-up to the host-syscalls move: the **entire** HandoffService is now gone from `apps/code`. Orchestration lives in core, host I/O in workspace-server, the port contract in shared, and the desktop keeps only a thin transport adapter + DI wiring.
- **core** `@posthog/core/handoff/handoff.ts` (`HandoffService`): preflight/execute/preflightToCloud/executeToCloud + `extractHandoffErrorCode` + both saga constructions + `closeCloudRun` (via `CLOUD_TASK_SERVICE`). Injects a single `HANDOFF_HOST` port (from shared) + `CLOUD_TASK_SERVICE` + `HANDOFF_LOGGER`. `handoff.module` binds `HANDOFF_SERVICE`. Schemas moved to `@posthog/core/handoff/schemas` (`handoffLocalGitStateSchema` defined locally instead of importing `@posthog/agent/server/schemas`). Purity gate clean.
- **workspace-server** `services/handoff/service.ts` (`HandoffHostService implements HandoffHost`): owns ALL the host business logic — agent api client construction, `HandoffCheckpointTracker` capture/apply, `resumeFromLog`, `formatConversationForResume`, the `GIT_CHECKPOINT` notification append, workspace/repository repo orchestration (`attachWorkspaceToFolder` revert, `updateWorkspaceMode`), and the diverged-branch confirmation dialog. Injects ws `AgentService`/`AgentAuthAdapter` + `WORKSPACE_REPOSITORY`/`REPOSITORY_REPOSITORY` + platform `DIALOG_SERVICE`/`APP_LIFECYCLE_SERVICE` + two narrow gateways (`HANDOFF_GIT_GATEWAY`/`HANDOFF_LOG_GATEWAY`) for the child-process git/log syscalls.
- **shared** `handoff-host.ts`: the `HandoffHost` port contract (+ `HandoffApiContext`/`HandoffChangedFile`/`HandoffReconnectParams`/`HandoffResumeStateResult`), so core and workspace-server reference it without importing each other.
- **apps/code** keeps only: `services/handoff/git-gateway.ts` (`TrpcHandoffGitGateway` — a ~50-line desktop tRPC adapter over `workspaceClient.git`), `HANDOFF_LOG_GATEWAY` bound to the existing local-logs thin client, the one-line handoff router (now imports core schemas + injects `HANDOFF_SERVICE`), and the DI bindings. Deleted `services/handoff/{service,schemas,service.test}.ts`. Retired `MAIN_TOKENS.HandoffService`. No agent runtime, checkpoint, saga, or orchestration code remains in apps/code.
- Validation: full `pnpm typecheck` 21/21; `@posthog/core` handoff 22/22; ws-server handoff host 8/8 + local-logs 17/17; core purity gate 0 noRestrictedImports; biome clean; shared dist rebuilt. NOT run: live end-to-end handoff GUI smoke (env-gated).
