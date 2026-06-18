import type { PermissionRequest } from "@posthog/shared";

const OTHER_OPTION_ID = "_other";
const OTHER_OPTION_ID_ALT = "other";

export function isOtherPermissionOption(optionId: string): boolean {
  return optionId === OTHER_OPTION_ID || optionId === OTHER_OPTION_ID_ALT;
}

export interface PermissionSelectionPlan {
  applyAllowAlwaysUpgrade: boolean;
  respondWithCustomInput: boolean;
  resendPromptText: string | null;
}

export function planPermissionResponse(
  permission: PermissionRequest,
  optionId: string,
  customInput?: string,
): PermissionSelectionPlan {
  const selectedOption = permission.options.find(
    (o) => o.optionId === optionId,
  );
  const isModeSwitch = permission.toolCall?.kind === "switch_mode";
  const applyAllowAlwaysUpgrade =
    selectedOption?.kind === "allow_always" && !isModeSwitch;

  const optionTakesCustomInput =
    isOtherPermissionOption(optionId) ||
    (selectedOption?._meta as { customInput?: boolean } | undefined)
      ?.customInput === true;

  if (customInput && optionTakesCustomInput) {
    return {
      applyAllowAlwaysUpgrade,
      respondWithCustomInput: true,
      resendPromptText: null,
    };
  }

  if (customInput) {
    return {
      applyAllowAlwaysUpgrade,
      respondWithCustomInput: false,
      resendPromptText: customInput,
    };
  }

  return {
    applyAllowAlwaysUpgrade,
    respondWithCustomInput: false,
    resendPromptText: null,
  };
}
