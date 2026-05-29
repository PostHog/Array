import type { SituationId } from "@shared/types/workflow";

// Fixed canvas layout. Positions are NOT user-editable — the workflow shape
// is a designer-authored map, not a user-authored graph. Numbers are unitless
// "canvas points"; the renderer scales them into a responsive container.

export const MAP_WIDTH = 1100;
export const MAP_HEIGHT = 720;

export interface StationLayout {
  x: number; // top-left of the station card, in canvas points
  y: number;
  w: number;
  h: number;
}

export const STATION_LAYOUT: Record<SituationId, StationLayout> = {
  // Top — entry point
  working: { x: 420, y: 30, w: 260, h: 110 },

  // Hub — most work passes through here
  in_review: { x: 420, y: 200, w: 260, h: 110 },

  // Side stations — attention-needing variants of in_review
  ci_failing: { x: 60, y: 370, w: 260, h: 110 },
  changes_requested: { x: 420, y: 370, w: 260, h: 110 },
  comments_waiting: { x: 780, y: 370, w: 260, h: 110 },

  // Approval gate
  ready_to_merge: { x: 420, y: 540, w: 260, h: 110 },

  // Modifier — parked to the right, can apply at any stage
  stale: { x: 780, y: 30, w: 260, h: 110 },

  // Terminal — bottom right, off the active flow
  done: { x: 780, y: 540, w: 260, h: 110 },
};

export interface FlowArrow {
  from: SituationId;
  to: SituationId;
  /** Visual hint — `branch` arrows are drawn dotted to suggest "and/or". */
  kind: "main" | "branch";
}

// Decorative arrows. These are NOT runtime edges — they're hand-authored
// hints about the typical progression of work, drawn dotted/subtle so the
// user reads them as guidance, not promises. The system doesn't enforce or
// observe these transitions.
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

// Per-situation accent colours for the canvas station. Indices on the Radix
// scale (`*-3` bg, `*-8` border) are chosen to read in both light and dark
// modes without relying on coloured shadows.
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
