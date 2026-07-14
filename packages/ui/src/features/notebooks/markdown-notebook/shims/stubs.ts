/**
 * Local stand-ins for posthog webapp enums referenced by the vendored editor
 * (`Scene` from `scenes/sceneTypes`, `ProductKey` from the query schema).
 * Only the members the vendored files use are defined; values match upstream.
 */
export const Scene = {
  Notebook: "Notebook",
} as const;

export const ProductKey = {
  NOTEBOOKS: "notebooks",
} as const;
