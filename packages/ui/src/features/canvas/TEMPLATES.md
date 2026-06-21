# Canvas templates — current state

> **History:** Canvases originally shipped as a **declarative json-render** tier —
> the agent emitted JSONL patches against a component catalog, rendered as a Quill
> component tree, with HogQL queries re-run on refresh by `dashboardQueryService`.
> That tier has been **removed**. All canvases are now **freeform React**: the
> agent writes a single-file React app that runs in a sandboxed iframe and talks to
> PostHog only through the injected `ph` shim. The earlier design doc that lived
> here (declarative/controlled/open-ended stance, per-template catalogs, the
> json-render runtime) described the removed tier and is no longer accurate.

## What a canvas is today

- A canvas record is a `dashboard`-typed desktop-fs row whose `meta` carries the
  agent-authored React `code`, its `versions` edit history, the `currentVersionId`
  pointer, author `context`, and a `templateId`.
- **Templates** are still data (`CanvasTemplate` records served by
  `CanvasTemplatesService`, listed via the `canvasTemplates` tRPC router and the
  create-picker `NewCanvasMenu`). Only **`freeform`** is offered today; more can be
  appended in `BUILT_IN_TEMPLATES` (`@posthog/core/canvas/canvasTemplates.ts`).
- A template's job is to inject the **agent system prompt**. Legacy canvases that
  still carry the older `dashboard` / `web-analytics` `templateId`s resolve their
  richer freeform layout prompts via `freeformSystemPromptFor` — there is no
  migration, so those ids keep working even though the picker no longer offers them.
- Generation runs as a **dedicated agent task** (like `CONTEXT.md`), not an inline
  streaming session — see `freeformPrompt.ts` / `hooks/useGenerateFreeformCanvas.ts`.

## Where things live

- Agent prompts + templates: `@posthog/core/canvas/canvasTemplates.ts`,
  `canvasTemplatesService.ts`.
- The iframe + `ph` data shim: `features/canvas/freeform/` (`FreeformCanvas.tsx`,
  `sandboxRuntime.ts`, `freeformDataBridge.ts`) and host-side
  `@posthog/core/canvas/canvasDataService.ts`.
- Storage: `@posthog/core/canvas/dashboardsService.ts` + `dashboardSchemas.ts`.
- Deeper walkthrough of the freeform tier + the data path: the `canvas-templates`
  skill, and the forward-looking `docs/canvas-freeform-react-plan.md` (publish /
  external sharing).
