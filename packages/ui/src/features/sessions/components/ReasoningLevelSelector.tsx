import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import { isDefaultSelectOption, selectOptionDocsUrl } from "@posthog/shared";
import { flattenSelectOptions } from "../sessionStore";
import { useRetainedConfigOption } from "../useRetainedConfigOption";
import {
  ReasoningLevelDropdown,
  type ReasoningLevelOption,
  type ReasoningMenuSection,
} from "./ReasoningLevelDropdown";

interface ReasoningLevelSelectorProps {
  thoughtOption?: SessionConfigOption;
  contextWindowOption?: SessionConfigOption;
  fastModeOption?: SessionConfigOption;
  onChange?: (value: string) => void;
  onConfigOptionChange?: (configId: string, value: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function toDropdownOptions(
  option: SessionConfigOption,
): ReasoningLevelOption[] {
  if (option.type !== "select") return [];
  return flattenSelectOptions(option.options).map((entry) => ({
    value: entry.value,
    label: entry.name,
    isDefault: isDefaultSelectOption(entry._meta),
    docsUrl: selectOptionDocsUrl(entry._meta),
  }));
}

export function ReasoningLevelSelector({
  thoughtOption,
  contextWindowOption,
  fastModeOption,
  onChange,
  onConfigOptionChange,
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

  const sections: ReasoningMenuSection[] = [];
  for (const option of [contextWindowOption, fastModeOption]) {
    if (!option || option.type !== "select" || !onConfigOptionChange) continue;
    sections.push({
      key: option.id,
      label: option.name,
      value: option.currentValue,
      options: toDropdownOptions(option),
      onChange: (value) => onConfigOptionChange(option.id, value),
    });
  }

  return (
    <ReasoningLevelDropdown
      value={displayOption.currentValue}
      options={toDropdownOptions(displayOption)}
      onChange={onChange}
      sections={sections}
      disabled={disabled || isReloading}
    />
  );
}
