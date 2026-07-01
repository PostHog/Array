import {
  flattenSelectOptions,
  type useModeConfigOptionForTask,
} from "../stores/sessionStore";

type ModeConfigOption = ReturnType<typeof useModeConfigOptionForTask>;

/**
 * When an allow_always permission is granted outside a mode-switch prompt,
 * ratchet the session to the closest "auto-accept edits" preset offered by
 * this adapter's mode catalog. Claude exposes `acceptEdits`; Codex has no
 * exact equivalent, so fall back to `auto`. Returns undefined if neither is
 * available (in which case leave the current mode untouched).
 */
export function resolveAllowAlwaysUpgradeMode(
  modeOption: ModeConfigOption,
): string | undefined {
  if (modeOption?.type !== "select") return undefined;
  const availableIds = new Set(
    flattenSelectOptions(modeOption.options).map((opt) => opt.value),
  );
  if (availableIds.has("acceptEdits")) return "acceptEdits";
  if (availableIds.has("auto")) return "auto";
  return undefined;
}

/**
 * Adapter-appropriate non-bypass "standard" mode to revert to when bypass isn't
 * allowed locally. Claude's is `default`; Codex has no `default` — its closest
 * "standard, prompts for dangerous ops" preset is `auto`. Resolved against the
 * session's advertised mode catalog so we never send a value the adapter rejects
 * (a hardcoded "default" onto a codex session throws "Invalid params" and the
 * rollback re-arms the effect into a retry loop). Returns undefined if neither is
 * available (leave the current mode untouched).
 */
export function resolveBypassRevertMode(
  modeOption: ModeConfigOption,
): string | undefined {
  if (modeOption?.type !== "select") return undefined;
  const availableIds = new Set(
    flattenSelectOptions(modeOption.options).map((opt) => opt.value),
  );
  if (availableIds.has("default")) return "default"; // Claude
  if (availableIds.has("auto")) return "auto"; // Codex
  return undefined;
}
