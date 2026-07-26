---
name: building-react-quill-canvases
description: Author React and PostHog Quill canvas applications. Use when a canvas needs stateful UI, PostHog-native data visualization, forms, reusable components, accessibility, or application-like interaction. This is an implementation skill used from any task, not a separate canvas mode.
---

# Building React and Quill canvases

- Mount the application from `src/main.tsx` into the root in `index.html`.
- Use React 19 patterns and import UI primitives from `@posthog/quill`.
- Use Quill semantics, variants, and compound components before custom controls.
- Put layout utilities on wrappers. Do not override Quill typography, colors,
  borders, or spacing without a concrete reason.
- Use design tokens for colors and support light and dark themes. Never hardcode
  light-only colors.
- Keep effects cancellable and clean them up. Show loading, empty, and error
  states for every asynchronous data surface.
- Use exact dependency versions in the source project. Do not import Node APIs,
  initialize a PostHog client, fetch credentials, or load remote scripts.
- Use the injected `ph` global for PostHog operations. Declare every insight,
  capture event and inline-query permission in capabilities. Keep network
  origins empty until capability approval is available.
- Keep data results bounded and aggregate before rendering.
- Let Three.js or other browser libraries own their DOM/canvas element when
  mixing them with React; dispose renderers, animation frames, and listeners.

Run canvas validation after meaningful changes and repair all build, capability,
and first-render errors before publishing.
