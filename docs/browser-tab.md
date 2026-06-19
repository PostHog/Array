# Browser Tab — Implementation Tracker

Embed a real Chromium `WebContentsView` as a first-class tab type in PostHog Code's panel system, giving it the same feel as the terminal tab but for browsing the web.

## Architecture

```
Renderer (React)                        Main (Electron)
─────────────────────────────────────   ────────────────────────────────────
BrowserPanel                            BrowserService
  ├─ BrowserToolbar (URL bar, nav)        ├─ Map<browserId, WebContentsView>
  └─ <div ref={contentRef} />            ├─ create(id, url)
       │                                  ├─ setBounds(id, x, y, w, h)
       │  ResizeObserver → bounds         ├─ setVisible(id, bool)
       │  tab active/hidden state         ├─ navigate(id, url)
       └──────── tRPC (host router) ──▶  └─ goBack / goForward / reload

Subscriptions ◀──────────────────────── onNavigate(id) → url
                                         onTitle(id) → string
                                         onFavicon(id) → string
```

The `WebContentsView` is a native Electron overlay — not a DOM element. React tracks the content area's bounds via `ResizeObserver` and pushes `{x, y, width, height}` to main whenever layout changes. Main repositions the overlay accordingly.

## Steps

### Phase 1 — Plumbing (Steps 1–3)

- [x] **Step 1** — Add `browser` type to `TabData` union + panel layout helpers
  - `packages/core/src/panels/panelTypes.ts`
  - `packages/core/src/panels/panelLayoutTransforms.ts`
  - `packages/ui/src/features/panels/panelLayoutStore.ts`

- [x] **Step 2** — Main-process `BrowserService`
  - `apps/code/src/main/services/browser.service.ts`
  - Register in DI container + `BindingMap`

- [x] **Step 3** — Host router
  - `packages/host-router/src/routers/browser.router.ts`
  - Wire into root host router

### Phase 2 — UI (Steps 4–5)

- [x] **Step 4** — React panel components
  - `packages/ui/src/features/browser/BrowserPanel.tsx` — bounds sync + visibility
  - `packages/ui/src/features/browser/BrowserToolbar.tsx` — URL bar, nav buttons
  - `packages/ui/src/features/browser/browserStore.ts` — view-state (url, title, favicon, loading)

- [x] **Step 5** — Wire into tab system
  - `TabContentRenderer.tsx` — add `case "browser"`
  - `usePanelLayoutHooks.tsx` — add Globe icon
  - Tab bar `+` menu — add "Open Browser" option

### Phase 3 — Polish (Step 6)

- [ ] **Step 6** — Edge cases + UX
  - [ ] Bounds re-sync on window resize, split-panel drag, tab drag/drop
  - [ ] `setVisible(false)` when tab goes background (prevent bleed-through)
  - [ ] New-tab empty state with search bar
  - [ ] Context menu (Copy URL, Open in external browser, DevTools)
  - [ ] Keyboard shortcuts: `Cmd+L` (focus URL), `Cmd+R` (reload), `Cmd+[/]` (back/forward)
  - [x] Security: `will-navigate` lockdown (http/https only), `setWindowOpenHandler` intercept, shared `persist:browser` session
  - [x] Branded PostHog error page (hedgehog + dark theme) on `did-fail-load`

### Phase 4 — Analytics (Future)

- [ ] **Step 7** — Instrument browser tab usage
  - Track `browser_tab_opened` event (source: globe icon vs `window.open()`)
  - Track `browser_tab_navigated` (distinguish user-typed URL vs back/forward vs page-triggered)
  - Track `browser_tab_closed` (with session duration)
  - Track `browser_tab_count` (how many concurrent tabs open)
  - Consider privacy: only capture domain/hostname, never full URLs (may contain tokens or PII)
  - Gate behind the existing PostHog analytics consent flow
  - Use the existing `analyticsRouter` / analytics service pattern already in the codebase

### Phase 5 — Chat Link Integration (Future)

- [ ] **Step 8** — Links in chat open in the in-app browser
  - Intercept `<a href>` clicks in the chat/message renderer
  - Open `http`/`https` links in a new browser tab in the active panel (`addBrowserTab`)
  - Right-click context menu on links: "Open in App Browser" (default) + "Open in System Browser" (`shell.openExternal`)
  - Non-http links (e.g. `file://`, `posthog://`) keep existing behavior (system handler)

## Timeline Estimate

| Phase | Estimate |
|---|---|
| Phase 1 (plumbing) | ~2 days |
| Phase 2 (UI) | ~2 days |
| Phase 3 (polish) | ~1.5 days |
| **MVP total** | **~5–6 days** |

## Key Files

| File | Role |
|---|---|
| `packages/core/src/panels/panelTypes.ts` | `TabData` union — add `browser` variant |
| `packages/core/src/panels/panelLayoutTransforms.ts` | Pure tab-creation transform |
| `packages/ui/src/features/panels/panelLayoutStore.ts` | Zustand store action |
| `apps/code/src/main/services/browser.service.ts` | `WebContentsView` lifecycle (new) |
| `apps/code/src/main/di/` | DI token + BindingMap entry |
| `packages/host-router/src/routers/browser.router.ts` | tRPC router (new) |
| `packages/ui/src/features/browser/BrowserPanel.tsx` | React panel + bounds sync (new) |
| `packages/ui/src/features/browser/BrowserToolbar.tsx` | Navigation UI (new) |
| `packages/ui/src/features/browser/browserStore.ts` | View-state store (new) |
| `packages/ui/src/features/task-detail/components/TabContentRenderer.tsx` | Dispatch `browser` case |
| `packages/ui/src/features/panels/hooks/usePanelLayoutHooks.tsx` | Globe icon for browser tab |
