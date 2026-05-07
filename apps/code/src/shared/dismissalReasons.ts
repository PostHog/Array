/**
 * Canonical dismiss / suppress reasons shown in the app. Values are persisted on dismissal artefacts.
 * Types are derived from this list — add or reorder options here only.
 */
export const DISMISSAL_REASON_OPTIONS = [
  {
    value: "already_fixed",
    label: "Already fixed",
    snoozesInsteadOfDismiss: true,
  },
  {
    value: "report_unclear",
    label: "Report is unclear to me",
  },
  {
    value: "analysis_wrong",
    label: "Agent's analysis is wrong",
  },
  {
    value: "wontfix_intentional",
    label: "Won't fix - intentional behavior",
  },
  {
    value: "wontfix_irrelevant",
    label: "Won't fix - issue is real but insignificant",
  },
  { value: "other", label: "Something else…" },
] as const;

export type DismissalReasonOptionValue =
  (typeof DISMISSAL_REASON_OPTIONS)[number]["value"];

/** Reasons only accepted when parsing older artefacts from the API (no longer offered in the UI). */
export const LEGACY_DISMISSAL_REASONS = [
  "analysis_not_understood",
  "wrong_reviewer",
] as const;

/**
 * Stored dismissal reason: current option values plus deprecated literals we still deserialize.
 * For UI-only typing (radio selection), use {@link DismissalReasonOptionValue}.
 */
export type DismissalReason =
  | DismissalReasonOptionValue
  | (typeof LEGACY_DISMISSAL_REASONS)[number];

/** Whether the given reason snoozes the report (temporarily) instead of permanently dismissing it. */
export function isDismissalReasonSnooze(
  value: DismissalReasonOptionValue,
): boolean {
  const option = DISMISSAL_REASON_OPTIONS.find((o) => o.value === value);
  return (
    option != null &&
    "snoozesInsteadOfDismiss" in option &&
    option.snoozesInsteadOfDismiss === true
  );
}
