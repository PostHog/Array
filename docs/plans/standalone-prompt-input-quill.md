# Design: Standalone composer input in quill + question tool

Status: design-review (no code yet)
Author: Adam Leith
Scope: `@posthog/quill` (source in `posthog/posthog` at `packages/quill`) + `@posthog/ui` in `posthog/code`

## Goal

Move the presentational *shell* of `code`'s prompt input into `@posthog/quill` as a
reusable, host-agnostic composer, so every surface renders the same box. Then add a
**question tool** surface that reuses that same shell, so when the agent asks a
question the composer *appears to stay pinned at the bottom* and becomes a
"talk about it" input — visually identical to the message composer, even though it
is a different element with different behavior.

### Non-goals (this pass)

- No editor engine in quill. Tiptap stays in `code`. Quill owns layout only.
- No change to draft/attachment/mode/skills logic. Those stay in `code` as slotted children.
- No new "grow" mechanism — quill's `InputGroup` already grows for block-aligned addons.

## Decisions locked in review

1. **Design/API only** for now — this document. Implementation follows in a later pass.
2. **Pure presentational shell** — quill owns `InputGroup` composition, addon slots,
   toolbar row, submit/stop button styling, states, and grow behavior. All tiptap / ACP /
   store logic stays in `code` and is passed as children/slots.
3. **Question surface = same shell.** The message composer and the question surface must
   look and sit identically so the bottom input reads as continuous. They may be different
   React elements, but they render the same quill shell.
4. **Motion is opt-out, never forced.** Quill ships a sensible *default* transition (e.g.
   the box expanding upward when a question tool activates) but never mandates it. Consumers
   can drop to `transition: none` — or any curve/duration — without fighting the library.
   See §2c.

---

## 1. What exists today

`packages/ui/src/features/message-editor/components/PromptInput.tsx` (473 lines) is
**already** built on quill's `InputGroup` / `InputGroupAddon` / `InputGroupButton`. Anatomy:

```
InputGroup (focus ring, bash-mode ring, cursor-text, grows via block addons)
├─ InputGroupAddon align="block-start"   → headerAddon slot + <AttachmentsBar/>
├─ div.cli-editor-scroll (min-h 50px, max-h 200px|45vh, overflow-y)
│    └─ <EditorContent editor={tiptap}/>          ← domain (tiptap)
└─ InputGroupAddon align="block-end" (toolbar)
     ├─ <AttachmentMenu/> <ModeSelector/> {modelSelector} {reasoningSelector}
     │   {messagingModeToggle} {bash indicator}     ← domain, some already slots
     └─ span.ml-auto → {historyButton} + submit/stop <InputGroupButton/>
   (+ optional <SlotMachineSubmit/> sibling outside the box)
```

**Already slot-shaped** (passed as `ReactNode` props): `modelSelector`,
`reasoningSelector`, `messagingModeToggle`, `historyButton`, `headerAddon`. The refactor
formalizes and completes this pattern.

**Domain guts that must stay in `code` and be passed in:**

| Piece | Why it can't be in quill |
| --- | --- |
| `useTiptapEditor` + `<EditorContent>` | Tiptap, ACP SDK, `draftStore`, skills, commands |
| `AttachmentMenu`, `AttachmentsBar` | host file API, chip insertion |
| `ModeSelector` | ACP `SessionConfigOption`, `sessionStore` |
| `ModelSelector`, `ReasoningLevelSelector`, `SteerQueueToggle` | already slotted |
| `SlotMachineSubmit`, history dialog | app state / settings |
| hotkeys, focus mgmt, submit/cancel logic, `EditorHandle` imperative API | app behavior |

**Consumers to keep working (5):** `SessionView` (main chat composer), `TaskInput`
(new-task), `PiSessionView`, `FreeformGenerateBar` (canvas), `ChannelHomeComposer` (channels).

### The "grow" is already free

`packages/quill/packages/primitives/src/input-group.css`:

```css
.quill-input-group:has(> [data-align='block-start']),
.quill-input-group:has(> [data-align='block-end']) {
    flex-direction: column;
    height: auto;           /* container grows to fit children */
}
```

So "the input grows to fit the question tool's children" needs no new mechanism — the
question content is a `block-start` addon inside the same `InputGroup`. **The
`InputGroup` primitive is enough** for the growth, confirming the hunch.

### The question tool today

- `permissions/QuestionPermission.tsx` parses the tool's `_meta` questions and renders
  `primitives/action-selector/ActionSelector` (option rows, single/multi-select, step
  tabs, inline custom input, submit/cancel; selection + keyboard nav live in
  `useActionSelectorState`).
- `session-update/QuestionToolView.tsx` renders the collapsed transcript row.
- In `SessionView.tsx` the composer slot is an **either/or**: a pending question renders
  the `ActionSelector` card **instead of** `PromptInput` (`:646` vs `:655`). This is the
  swap we want to replace with continuity.

---

## 2. Proposed quill additions

Layer: **`@posthog/quill-components`** (composed primitives), not a new primitive — the
composer composes `InputGroup` + `Button`, which is exactly the components layer's job.
The question-option row and step tabs reuse existing primitives (`Item`, `Tabs`) where possible.

### 2a. `Composer` — the shell (compositional API)

Mirrors quill's composition-over-props ethos (like `Card` / `Item`). Every part is a thin
wrapper over an `InputGroup` slot so the box, grow, and focus states come for free.

```tsx
<Composer state="default">                 {/* InputGroup + variants + grow */}
  <ComposerHeader>{/* block-start addon: attachments, context chips, question tool */}</ComposerHeader>
  <ComposerBody>{editor}</ComposerBody>     {/* scroll area; children = <EditorContent/> from code */}
  <ComposerToolbar>                          {/* block-end addon */}
    <ComposerToolbarStart>{/* attach, mode, model, reasoning */}</ComposerToolbarStart>
    <ComposerToolbarEnd>{/* history + <ComposerSubmit/> */}</ComposerToolbarEnd>
  </ComposerToolbar>
</Composer>
```

| Component | Wraps | Owns |
| --- | --- | --- |
| `Composer` | `InputGroup` | focus/hover ring, `cursor-text`, `state` variant, grow, `onClick`-to-focus escape (via `onFocusRequest` callback — quill can't reach the editor, so it exposes the intent) |
| `ComposerHeader` | `InputGroupAddon align="block-start"` | top padding, full-width stacking |
| `ComposerBody` | scroll `div` | `min-h`, `max-h` (`size` prop: `default` 200px / `large` 45vh), `overflow-y`, text size |
| `ComposerToolbar` | `InputGroupAddon align="block-end"` | 1px padding, row layout |
| `ComposerToolbarStart` / `ComposerToolbarEnd` | `span` | left cluster / `ml-auto` right cluster |
| `ComposerSubmit` | `InputGroupButton` | sizing + variant presets; children = icon |

**`Composer` props (presentational only):**

| Prop | Type | Purpose |
| --- | --- | --- |
| `state` | `"default" \| "accent" \| "invalid"` | `accent` = the blue bash-mode ring; `invalid` = destructive ring. Default relies on `InputGroup` focus-within. |
| `size` | `"default" \| "large"` | forwards to `ComposerBody` max-height |
| `motion` | `"default" \| "none"` | ergonomic sugar for the grow/expand transition (§2c). `default` = quill's default curve; `none` = no transition. Never forces animation — just sets the underlying custom property / `data-motion` attribute, which the consumer can also set directly. |
| `onFocusRequest` | `() => void` | click on empty chrome → code focuses its editor (quill has no editor ref) |
| `className`, `...div` | | passthrough |

**`ComposerSubmit` props:**

| Prop | Type | Purpose |
| --- | --- | --- |
| `intent` | `"send" \| "stop"` | `send` = primary; `stop` = destructive. Icon passed as children (code uses phosphor; quill stays icon-agnostic). |
| `disabled`, `onClick`, `aria-label` | | standard |

Icons: `code` passes phosphor `ArrowUp` / `Stop` as children — quill does not import an
icon set for these, keeping it host-agnostic (quill's own examples use lucide, but the
button accepts any node).

**Why a `Composer` wrapper instead of "just use `InputGroup`":** the five call sites each
re-hand-roll the scroll `div` classes, the `ml-auto` submit cluster, the focus-ring
className, and the `block-start`/`block-end` addon choreography. `Composer` makes that one
opinionated, tested, storybook'd surface — and, crucially, is what lets the **question
surface reuse the identical shell** (section 3) rather than approximating it.

### 2b. Question-option primitives (probably mostly existing quill)

The presentational question surface is: an optional step-tab strip, a title + question
line, a list of selectable option rows (single or multi, each with a label + description),
and submit/cancel actions. Most of this already exists in quill:

| Need | Existing quill | Gap |
| --- | --- | --- |
| selectable option rows | `Item variant="pressable"` + `ItemContent`/`ItemTitle`/`ItemDescription`, `tone` | a selected/checked visual + radio/checkbox affordance + keyboard roving |
| multi-select checkmark | `ItemGroup` + `Checkbox` | compose |
| step tabs | `Tabs variant="line"` | completed-state dot |
| custom "Other" input | `Composer` body itself (see §3) | — |

Proposal: add a thin **`QuestionOptions` / `QuestionOption`** pair (or a `selectable`
variant on `Item`) that renders the option row with a radio/checkbox slot, description, and
`data-selected`/keyboard support — and a `QuestionSteps` wrapper over `Tabs` with a
`completed` dot. Selection state, keyboard handling, and step advancement **stay in
`code`** (today's `useActionSelectorState`); quill only styles the rows.

Open call for review: this may be light enough that we keep the whole `ActionSelector`
option-row rendering in `code` and only ship `Composer`. See Open Questions Q2.

### 2c. Motion policy — defaults, not mandates

The most visible motion is the box **growing upward** when a question tool activates
(default → question mode) and shrinking back. Quill should own a *good default* for this
but must never impose it — a consumer that wants an instant, non-animated expand (or a
different curve) must get there without `!important` battles or re-implementing the shell.

**Mechanism (matches quill's existing tunable pattern, e.g. `--quill-shimmer-base`):**

1. The transition is declared against a **CSS custom property with a built-in default**,
   not a hardcoded literal:

   ```css
   .quill-composer {
     /* grow/shrink of the block-addon stack; height:auto isn't natively animatable, so
        the implementation uses the grid-rows 0fr↔1fr (or interpolate-size) technique on
        the addon wrapper — the point here is the *transition* is overridable. */
     transition: var(--quill-composer-motion, grid-template-rows 150ms ease, height 150ms ease);
   }
   ```

2. Consumers override at any level, no library fork:

   ```css
   /* kill it everywhere */
   :root { --quill-composer-motion: none; }
   /* or per-instance */
   <Composer motion="none" />                 /* sets --quill-composer-motion: none */
   <Composer style={{ "--quill-composer-motion": "grid-template-rows 300ms ease-out" }} />
   ```

3. `prefers-reduced-motion: reduce` collapses the default to `none` automatically — but an
   explicit consumer value still wins, so reduced-motion is a floor, not an override of intent.

**Rules this encodes:**

- Quill never writes a bare `transition:` the consumer can't reach. Every animated property
  routes through a custom property with a default, so "go to `transition: none`" is a
  one-line override, not a fight.
- The `motion` prop is *only* sugar over that property — the CSS custom property and
  `data-motion` attribute remain the source of truth, so app-wide theming (set the property
  once at the root) and per-instance opt-out both work.
- Same policy applies to any other Composer motion we add (submit-button state cross-fade,
  focus ring). Default provided, always overridable, reduced-motion respected.
- This does **not** change today's behavior on the InputGroup primitive itself, which only
  transitions `color`/`background`/`border` and grows instantly — the Composer *adds* an
  opt-out-able grow transition on top; leaving `motion` unset on a plain `InputGroup` keeps
  the current instant grow.

---

## 3. The question surface — continuity at the bottom

Requirement from review: *the input seemingly stays at the bottom and becomes the
"talk about it" input when a question is available; it must look exactly the same.*

Reconciliation: **one `Composer` shell always occupies the bottom.** Its *contents* change
with mode. There is no swap of the visible box — only its header and toolbar action swap.

### Message mode (default)

```
Composer
├─ ComposerHeader   → attachments (when present)
├─ ComposerBody     → tiptap editor ("Type a message…")
└─ ComposerToolbar  → [attach · mode · model · reasoning]  … [history · Send]
```

### Question mode (a question tool is pending)

```
Composer                                   ← same shell, same position, grows upward
├─ ComposerHeader   → <QuestionSteps/> + question title/text + <QuestionOptions/>
├─ ComposerBody     → tiptap editor, placeholder "Talk about it…"   ← the "talk about it" input
└─ ComposerToolbar  → [mode?]  … [Submit answer]      (Send becomes Submit; Enter in body = discuss)
```

- The **options render in `ComposerHeader`** (block-start addon) so the box grows upward
  from the pinned bottom — nothing below moves, the input appears to stay put and expand.
  The grow uses the default, overridable transition from §2c (a consumer can set
  `motion="none"` for an instant expand).
- The **body stays a live editor** as the "talk about it" / free-text / "Other" answer.
  Typing + Enter there submits a discussion message (or the custom answer); the toolbar's
  **Submit answer** commits the selected option(s). This is exactly the "becomes the talk
  about it input" behavior.
- Because both modes render the **same `Composer`**, the transition is a content change,
  not a remount — true visual continuity, no fl. The user's "it may be a different
  element but must look identical" is satisfied by shared shell: even if `code` chooses to
  mount a distinct `<QuestionComposer>` component, it renders `Composer` internally, so it
  is pixel-identical to `<MessageComposer>`.

### Recommended code structure (later pass)

- `MessageComposer` (rename/thin-wrap today's `PromptInput`) → renders `Composer` with the
  message-mode slots. Keeps `EditorHandle`, hotkeys, submit logic.
- `QuestionComposer` → renders `Composer` with question-mode slots; drives selection via
  today's `useActionSelectorState` + `questionDraftStore`; shares the same `useTiptapEditor`
  for the "talk about it" body.
- `SessionView` composer slot stops doing either/or of *different-looking* cards; it always
  renders a `Composer`-shaped element, switching message ↔ question contents.

---

## 4. `PromptInput` before / after

**Before:** `PromptInput` owns the box classes, scroll div, toolbar layout, submit cluster,
and grow choreography inline, plus all domain wiring.

**After:** `PromptInput` (→ `MessageComposer`) keeps only domain wiring and passes slots:

```tsx
<Composer state={isBashMode ? "accent" : "default"} size={editorHeight} onFocusRequest={focus}>
  {headerAddon && <ComposerHeader>{headerAddon}</ComposerHeader>}
  {attachments.length > 0 && (
    <ComposerHeader><AttachmentsBar attachments={attachments} onRemove={removeAttachment}/></ComposerHeader>
  )}
  <ComposerBody size={editorHeight}><EditorContent editor={editor}/></ComposerBody>
  <ComposerToolbar>
    <ComposerToolbarStart>
      {!hideDefaultToolbar && <><AttachmentMenu …/>{onModeChange && <ModeSelector …/>}{modelSelector}{reasoningSelector}{messagingModeToggle}{isBashMode && <BashHint/>}</>}
    </ComposerToolbarStart>
    <ComposerToolbarEnd>
      {!hideDefaultToolbar && historyButton}
      {inStopMode
        ? <ComposerSubmit intent="stop" onClick={onCancel} aria-label="Stop"><Stop/></ComposerSubmit>
        : !slotMachineMode && <ComposerSubmit intent="send" disabled={submitBlocked} onClick={doSubmit} aria-label="Send message"><ArrowUp/></ComposerSubmit>}
    </ComposerToolbarEnd>
  </ComposerToolbar>
</Composer>
```

`SlotMachineSubmit` stays a `code`-side sibling. The `EditorHandle` `useImperativeHandle`,
all `useHotkeys`, `useDraftStore`, skills effect, and callbacks are unchanged.

---

## 5. Migration plan (phased)

1. **Quill:** add `Composer*` (+ optional `QuestionOptions`/`QuestionSteps`) to
   `packages/quill/packages/components`, export from that package's `src/index.ts` (flows to
   `@posthog/quill` on build). Storybook stories for message mode, grown/attachments mode,
   question mode. Update `packages/components/AGENTS.md` (lint-staged enforces this).
2. **Local sync into `code`:** build quill workspace → `npm pack` → point the
   `pnpm-workspace.yaml` override at the `.local-quill/*.tgz` → `pnpm install` (the
   `quill-code` skill loop). Temporary; reverted before merge.
3. **`code`:** refactor `PromptInput` → `MessageComposer` over `Composer` with **zero
   behavior change**. Land + verify all 5 consumers unchanged (Storybook + `PromptInput.test`
   + `test-electron-app`).
4. **`code`:** add `QuestionComposer` over `Composer`; switch `SessionView`'s composer slot
   from the either/or swap to the shared-shell content switch. Migrate `QuestionPermission`
   rendering into it.
5. **Publish** the quill version, bump the catalog pin in `code`, drop the tarball override.
6. Roll the shared shell into the other consumers as desired.

Steps 3 and 4 are independently shippable; 4 depends on 3.

---

## 6. Risks / open questions

- **Q1 — layer.** `Composer` as a quill *component* (composed primitives) vs a *block*
  (product pattern). Recommendation: component, since it's a generic input shell, not a
  product-specific card. Confirm.
- **Q2 — how much of the question tool goes to quill.** Ship only `Composer` and keep the
  `ActionSelector` option-row rendering in `code`? Or extract `QuestionOptions`/`QuestionSteps`
  to quill too? Recommendation: start with `Composer` only (unblocks the continuity win);
  extract option rows to quill later if reuse appears. The "talk about it" continuity does
  **not** require the option rows to be in quill.
- **Q3 — icons.** Quill stays icon-agnostic for `ComposerSubmit` (children). `code` keeps
  phosphor. OK?
- **Q4 — bash-mode / focus ring.** Encoded as `state="accent"` on `Composer` vs a
  `className` passthrough. Recommendation: a small named `state` set so the ring is a quill
  concern, not a magic className. Confirm the variant vocabulary (`default`/`accent`/`invalid`).
- **Q5 — `onFocusRequest`.** Quill can't hold the editor ref, so click-on-chrome-to-focus is
  surfaced as a callback. Acceptable seam?
- **Q6 — `EditorHandle`.** Stays entirely in `code`; quill exposes no imperative handle. Confirm.
- **Q7 — shipped motion default.** The grow transition is always overridable (§2c); the
  question is what quill ships as the *default* — a subtle animated expand, or `none` (motion
  strictly opt-in per instance)? Recommendation: ship a subtle default expand + honor
  reduced-motion, since the continuity effect is the point; `code` can still set `motion="none"`
  anywhere it wants instant. Confirm.

---

## Appendix: file map

Quill (new, in `posthog/posthog`):
- `packages/quill/packages/components/src/composer.tsx` (+ `.css`, `.stories.tsx`)
- (maybe) `packages/quill/packages/components/src/question-options.tsx`
- export additions in `packages/quill/packages/components/src/index.ts`
- `packages/quill/packages/components/AGENTS.md` update

Code (later passes, in `posthog/code`):
- `packages/ui/src/features/message-editor/components/PromptInput.tsx` → `MessageComposer`
- `packages/ui/src/features/permissions/QuestionComposer.tsx` (new)
- `packages/ui/src/features/sessions/components/SessionView.tsx` (composer slot switch)
- unchanged domain: `useTiptapEditor`, `draftStore`, `AttachmentMenu`, `ModeSelector`,
  `useActionSelectorState`, `questionDraftStore`
