import {
  FREEFORM_SYSTEM_PROMPT,
  FREEFORM_TEMPLATE_ID,
} from "@posthog/shared/canvas-freeform-prompt";
import type { CanvasSuggestion } from "./templateSchemas";

export interface CanvasTemplate {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  /** Starter chips shown in an empty chat (label + the prompt it inserts). */
  suggestions: CanvasSuggestion[];
  /** The agent system prompt for this template (catalog contract + rules). */
  systemPrompt: string;
}

const FREEFORM_SUGGESTIONS: CanvasSuggestion[] = [
  {
    label: "Signups chart",
    prompt:
      "Build an app that shows daily new signups for the last 30 days as a line chart, with a total at the top.",
  },
  {
    label: "Top events",
    prompt:
      "Build an app listing the top 10 events by volume in the last 7 days, with a bar chart and a refresh button.",
  },
  {
    label: "Metric explorer",
    prompt:
      "Build a small tool with a dropdown to pick an event and a chart that shows its daily count over the last 14 days.",
  },
];

const FREEFORM_TEMPLATE: CanvasTemplate = {
  id: FREEFORM_TEMPLATE_ID,
  name: "Freeform (React)",
  description:
    "Describe anything — the agent writes a real React app that runs in a sandbox and can be shared.",
  builtIn: true,
  suggestions: FREEFORM_SUGGESTIONS,
  systemPrompt: FREEFORM_SYSTEM_PROMPT,
};

/** Built-in templates offered by the create-picker. Only the freeform (React)
 * template exists today; more can be appended later. */
export const BUILT_IN_TEMPLATES: CanvasTemplate[] = [FREEFORM_TEMPLATE];

export const DEFAULT_TEMPLATE_ID = FREEFORM_TEMPLATE_ID;
