import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { isDefaultSelectOption, selectOptionDocsUrl } from "@posthog/shared";
import { flattenSelectOptions } from "../sessionStore";
import { useRetainedConfigOption } from "../useRetainedConfigOption";
import { ReasoningLevelDropdown } from "./ReasoningLevelDropdown";

interface ReasoningLevelSelectorProps {
  thoughtOption?: SessionConfigOption;
  onChange?: (value: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function ReasoningLevelSelector({
  thoughtOption,
  onChange,
  disabled,
  isLoading,
}: ReasoningLevelSelectorProps) {
  const displayOption = useRetainedConfigOption(thoughtOption);

  // Genuinely no reasoning levels for this harness/model: hide. While the
  // preview config reloads (a harness switch) keep showing the last value,
  // disabled, so the toolbar doesn't collapse mid-switch.
  if (!thoughtOption && !isLoading) return null;
  if (!displayOption || displayOption.type !== "select") {
    return null;
  }

  const isReloading = !thoughtOption;
  const options = flattenSelectOptions(displayOption.options).map((option) => ({
    value: option.value,
    label: option.name,
    isDefault: isDefaultSelectOption(option._meta),
    docsUrl: selectOptionDocsUrl(option._meta),
  }));

  return (
    <ReasoningLevelDropdown
      value={displayOption.currentValue}
      options={options}
      onChange={onChange}
      disabled={disabled || isReloading}
    />
  );
}
