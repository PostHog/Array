import type { Spec } from "@json-render/react";

/**
 * The dashboard's title: the text of the top-level h1 Heading the canvas always
 * starts with (see the per-template rules in core/canvas/canvasTemplates). This
 * h1 is the dashboard's name —
 * editing it (by the agent or inline) renames the saved dashboard. Falls back to
 * the root Page's `title` prop, then to undefined when no title is present.
 */
export function dashboardTitleFromSpec(
  spec: Spec | null | undefined,
): string | undefined {
  const root = spec?.root;
  const elements = spec?.elements;
  if (typeof root !== "string" || !elements) return undefined;

  const page = elements[root];
  if (!page) return undefined;

  for (const childKey of page.children ?? []) {
    const el = elements[childKey];
    if (!el || el.type !== "Heading") continue;
    const props = el.props as { level?: number; text?: unknown } | undefined;
    // Level defaults to 1 in the catalog, so a missing level is still the h1.
    if ((props?.level ?? 1) !== 1) continue;
    if (typeof props?.text === "string" && props.text.trim()) {
      return props.text.trim();
    }
  }

  const title = (page.props as { title?: unknown } | undefined)?.title;
  return typeof title === "string" && title.trim() ? title.trim() : undefined;
}
