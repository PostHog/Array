---
name: building-html-canvases
description: Author framework-light PostHog canvas applications with semantic HTML, CSS, TypeScript or JavaScript, Canvas, SVG, WebGL, Three.js, workers, and browser APIs. Use when React adds no useful structure or when building graphics, documents, experiments, games, or focused interactive experiences.
---

# Building HTML and graphics canvases

- Keep `index.html` semantic and accessible. Put executable code in one local
  module entry such as `src/main.ts`; inline and remote scripts are forbidden.
- Use CSS files for presentation. Respect reduced motion, keyboard access,
  focus visibility, responsive layouts, and light/dark design tokens.
- Use exact dependency versions and browser-compatible packages only.
- Never import Node built-ins, embed secrets, initialize a PostHog client, or
  bypass the injected `ph` SDK.
- For Canvas/WebGL/Three.js, size against the container and device pixel ratio,
  handle resize and context loss, cancel animation frames, and dispose GPU
  resources.
- Keep asset and bundle sizes bounded. Prefer generated geometry and optimized
  local assets over unbounded remote resources.
- Declare saved insights, capture events, and inline-query permission. Route
  host-mediated actions through the `ph` SDK. Direct external network origins
  are unavailable until capability approval is implemented.
- Treat React as an available library, not a prohibited one. A focused React
  island is valid when it simplifies one interactive region.

Validate the candidate artifact and its first render before publishing.
