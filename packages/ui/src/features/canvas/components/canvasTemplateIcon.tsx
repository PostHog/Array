import {
  ChartBarIcon,
  ChartLineIcon,
  FileHtmlIcon,
  FileIcon,
  ShapesIcon,
} from "@phosphor-icons/react";
import { FREEFORM_TEMPLATE_ID } from "@posthog/core/canvas/freeformSchemas";
import { HTML_TEMPLATE_ID } from "@posthog/core/canvas/htmlCanvasSchemas";
import type { ReactNode } from "react";

// A canvas's leading icon, chosen from its template so the tree and header read
// at a glance: bar chart for json-render dashboards, line chart for web
// analytics, shapes for the generic freeform canvas (until it's classified as
// something more specific), plain file for blank canvases, html file for
// HTML documents.
export function iconForTemplate(
  templateId: string,
  opts?: { size?: number; className?: string },
): ReactNode {
  const size = opts?.size ?? 16;
  const className = opts?.className ?? "text-gray-9";
  switch (templateId) {
    case "web-analytics":
      return <ChartLineIcon size={size} className={className} />;
    case "blank":
      return <FileIcon size={size} className={className} />;
    case FREEFORM_TEMPLATE_ID:
      return <ShapesIcon size={size} className={className} />;
    case HTML_TEMPLATE_ID:
      return <FileHtmlIcon size={size} className={className} />;
    default:
      return <ChartBarIcon size={size} className={className} />;
  }
}
