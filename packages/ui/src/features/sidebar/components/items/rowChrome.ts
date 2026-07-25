/**
 * Chrome shared by the sidebar's row hover affordances. The row components
 * themselves stay separate (they carry different content), but the classes that
 * make a hover action look like a hover action live here so a restyle lands in
 * one place instead of drifting between the Code sidebar and the channel one.
 */

/** A small square icon button revealed on row hover. */
export const ROW_HOVER_ACTION_CLASS =
  "flex h-5 w-5 cursor-pointer items-center justify-center rounded text-gray-10 transition-colors hover:bg-gray-4 hover:text-gray-12";

/** Wrapper that hides the action cluster until the row is hovered. */
export const ROW_HOVER_TOOLBAR_CLASS =
  "hidden shrink-0 items-center gap-0.5 group-hover:flex";

/** The relative timestamp shown until the hover actions take its place. */
export const ROW_TIMESTAMP_CLASS =
  "shrink-0 text-[11px] text-gray-11 group-hover:hidden";
