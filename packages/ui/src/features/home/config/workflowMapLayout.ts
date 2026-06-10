import type { SituationId } from "@posthog/core/workflow/schemas";

// Fixed designer-authored canvas layout, not a user-editable graph. Numbers are
// unitless "canvas points" the renderer scales into a responsive container.
export const MAP_WIDTH = 1100;
export const MAP_HEIGHT = 720;

export interface StationLayout {
  x: number; // top-left of the station card, in canvas points
  y: number;
  w: number;
  h: number;
}

export const STATION_LAYOUT: Record<SituationId, StationLayout> = {
  working: { x: 420, y: 30, w: 260, h: 110 },
  in_review: { x: 420, y: 200, w: 260, h: 110 },
  ci_failing: { x: 60, y: 370, w: 260, h: 110 },
  changes_requested: { x: 420, y: 370, w: 260, h: 110 },
  comments_waiting: { x: 780, y: 370, w: 260, h: 110 },
  ready_to_merge: { x: 420, y: 540, w: 260, h: 110 },
  stale: { x: 780, y: 30, w: 260, h: 110 },
  done: { x: 780, y: 540, w: 260, h: 110 },
};

export interface FlowArrow {
  from: SituationId;
  to: SituationId;
  /** Visual hint — `branch` arrows are drawn dotted to suggest "and/or". */
  kind: "main" | "branch";
}

// Decorative hints about the typical progression of work — NOT runtime edges.
// The system doesn't enforce or observe these transitions.
export const FLOW_ARROWS: FlowArrow[] = [
  { from: "working", to: "in_review", kind: "main" },
  { from: "in_review", to: "ci_failing", kind: "branch" },
  { from: "in_review", to: "changes_requested", kind: "branch" },
  { from: "in_review", to: "comments_waiting", kind: "branch" },
  { from: "ci_failing", to: "ready_to_merge", kind: "branch" },
  { from: "changes_requested", to: "ready_to_merge", kind: "branch" },
  { from: "comments_waiting", to: "ready_to_merge", kind: "branch" },
  { from: "in_review", to: "ready_to_merge", kind: "main" },
  { from: "ready_to_merge", to: "done", kind: "main" },
];

// Per-situation accent colours for the canvas station. Radix scale indices
// (`*-3` bg, `*-8` border) read in both light and dark modes.
export const SITUATION_TONE: Record<
  SituationId,
  { accent: string; bg: string; label: string }
> = {
  working: {
    accent: "border-(--blue-8)",
    bg: "bg-(--blue-3)",
    label: "text-(--blue-11)",
  },
  in_review: {
    accent: "border-(--violet-8)",
    bg: "bg-(--violet-3)",
    label: "text-(--violet-11)",
  },
  ci_failing: {
    accent: "border-(--red-8)",
    bg: "bg-(--red-3)",
    label: "text-(--red-11)",
  },
  changes_requested: {
    accent: "border-(--amber-8)",
    bg: "bg-(--amber-3)",
    label: "text-(--amber-11)",
  },
  comments_waiting: {
    accent: "border-(--amber-8)",
    bg: "bg-(--amber-3)",
    label: "text-(--amber-11)",
  },
  ready_to_merge: {
    accent: "border-(--green-8)",
    bg: "bg-(--green-3)",
    label: "text-(--green-11)",
  },
  stale: {
    accent: "border-(--gray-8)",
    bg: "bg-(--gray-3)",
    label: "text-(--gray-11)",
  },
  done: {
    accent: "border-(--gray-8)",
    bg: "bg-(--gray-3)",
    label: "text-(--gray-11)",
  },
};

/** Centre point of a station — used to anchor arrows. */
export function stationCentre(s: StationLayout): { x: number; y: number } {
  return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
}
