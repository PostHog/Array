import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react";
import { CANVAS_COMPONENTS } from "@posthog/core/canvas/componentCatalog";

// Renderer-side catalog: built on @json-render/react's `schema` so the view +
// edit renderers (registry.tsx → createRenderer) can render it. The component
// contract lives in @posthog/core/canvas/componentCatalog (one source for both
// renderer and main); the per-template agent system prompt is generated in the
// main process (CanvasTemplatesService), no longer here.
export const canvasCatalog = defineCatalog(schema, {
  components: CANVAS_COMPONENTS,
  actions: {},
});
