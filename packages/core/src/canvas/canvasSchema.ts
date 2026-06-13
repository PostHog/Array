import { defineSchema } from "@json-render/core";

// Core-only mirror of `@json-render/react`'s element-tree `schema`. That schema
// is itself pure `@json-render/core` (no React runtime), but it's only reachable
// via the React package's entrypoint — importing it would drag React into
// @posthog/core (forbidden: core must stay host-agnostic). So we re-declare the
// identical schema here, in core, where BOTH the main-process services (to
// generate the agent system prompt via `catalog.prompt()`) and the renderer can
// use it.
//
// IMPORTANT: keep this in lockstep with `@json-render/react`'s `schema`
// (pinned at @json-render/* 0.19.0). If that package's schema changes, mirror it.
export const canvasSchema = defineSchema(
  (s) => ({
    // What the AI-generated SPEC looks like.
    spec: s.object({
      root: s.string(),
      // Optional initial state model the UI reads/writes (form fields, toggles).
      state: s.any(),
      elements: s.record(
        s.object({
          type: s.ref("catalog.components"),
          props: s.propsOf("catalog.components"),
          children: s.array(s.string()),
          visible: s.any(),
          // Event → action bindings (e.g. { "click": { "action": "setState", … } }).
          on: s.any(),
        }),
      ),
    }),
    // What the CATALOG must provide.
    catalog: s.object({
      components: s.map({
        props: s.zod(),
        slots: s.array(s.string()),
        description: s.string(),
        example: s.any(),
      }),
      actions: s.map({
        params: s.zod(),
        description: s.string(),
      }),
    }),
  }),
  {
    builtInActions: [
      {
        name: "setState",
        description:
          "Update a value in the state model at the given statePath. Params: { statePath: string, value: any }",
      },
      {
        name: "pushState",
        description:
          'Append an item to an array in state. Params: { statePath: string, value: any, clearStatePath?: string }. Value can contain {"$state":"/path"} refs and "$id" for auto IDs.',
      },
      {
        name: "removeState",
        description:
          "Remove an item from an array in state by index. Params: { statePath: string, index: number }",
      },
      {
        name: "validateForm",
        description:
          "Validate all registered form fields and write the result to state. Params: { statePath?: string }. Defaults to /formValidation. Result: { valid: boolean, errors: Record<string, string[]> }.",
      },
    ],
    // NOTE: the canvas renderer now resolves json-render's DECLARATIVE dynamic
    // features — a top-level `state` model, `{$state}` reads, `{$bindState}`
    // two-way form bindings, `visible` conditions, and `on`/actions (the four
    // built-ins: setState/pushState/removeState/validateForm). It does NOT yet
    // resolve `repeat`/`{$item}`/`{$index}`; those still degrade to empty. We
    // drop the upstream default rules (which assume the full feature set) and
    // keep only the always-applicable guidance; the per-template rules
    // (canvasTemplates.ts) spell out exactly which dynamic features are allowed.
    defaultRules: [
      "CRITICAL INTEGRITY CHECK: Before outputting ANY element that references children, you MUST have already output (or will output) each child as its own element. If an element has children: ['a', 'b'], then elements 'a' and 'b' MUST exist. A missing child element causes that entire branch of the UI to be invisible.",
      "SELF-CHECK: After generating all elements, mentally walk the tree from root. Every key in every children array must resolve to a defined element. If you find a gap, output the missing element immediately.",
      "Design with visual hierarchy: use container components to group content, heading components for section titles, and proper spacing. ONLY use components from the AVAILABLE COMPONENTS list.",
      "For data-rich UIs, use multi-column layout components if available. For forms and single-column content, use vertical layout components. ONLY use components from the AVAILABLE COMPONENTS list.",
      "Always include realistic, professional-looking sample content written directly into each element's props. For a landing page, write real headlines and body copy; for a list, output each item as its own element. Never leave content empty.",
    ],
  },
);
