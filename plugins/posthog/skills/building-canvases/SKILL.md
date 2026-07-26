---
name: building-canvases
description: Build or edit PostHog canvases as arbitrary browser applications. Use whenever a task needs to create, update, repair, or reason about a canvas, regardless of whether the task started from the canvas UI. Routes between React/Quill, semantic HTML, graphics, WebGL, and mixed implementations, then validates and publishes through canvas tools.
---

# Building canvases

Treat a canvas as one browser application, not as a dashboard schema or a
framework choice for the user.

1. Resolve the target canvas. Use the preselected canvas when supplied;
   otherwise list, select, or create one with the PostHog canvas/file-system
   tools.
2. Read its current source project and version before editing. A legacy canvas
   may expose one React source file instead.
3. Choose the least complex implementation that satisfies the request:
   - use React and Quill for stateful PostHog interfaces, forms, and reusable UI;
   - use semantic HTML/CSS and direct browser APIs for documents and focused
     experiments;
   - use Canvas, WebGL, or Three.js directly for graphics;
   - mix approaches when useful.
4. Do not ask the user to choose a framework unless it changes an unresolved
   user-visible requirement.
5. Keep `index.html` as the entry and use exact dependency versions. Never add
   Node built-ins, remote scripts, lifecycle scripts, or secrets.
6. Read and follow `[[querying-canvas-data]]` when PostHog data is needed.
7. Read and follow the relevant implementation skill:
   `[[building-react-quill-canvases]]` or `[[building-html-canvases]]`.
8. Finish with `[[validating-and-publishing-canvases]]`.

Never write private PostHog credentials into source. Use the injected `ph` SDK
for PostHog data, capture, navigation, and safe external opens.
