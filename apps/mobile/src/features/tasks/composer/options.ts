import {
  type CloudTaskConfigOption,
  isRestrictedModelOption,
} from "@posthog/shared";

export interface MobileModelOption {
  value: string;
  label: string;
  description?: string;
  disabled: boolean;
}

export function getModelConfigOption(
  configOptions: readonly CloudTaskConfigOption[],
): CloudTaskConfigOption {
  const modelOption = configOptions.find(
    (option) => option.category === "model",
  );
  if (!modelOption) {
    throw new Error("Cloud task model configuration is unavailable");
  }
  return modelOption;
}

export function getMobileModelOptions(
  modelOption: CloudTaskConfigOption,
): MobileModelOption[] {
  return modelOption.options.map((option) => ({
    value: option.value,
    label: option.name,
    description: option.description,
    disabled: isRestrictedModelOption(option._meta),
  }));
}

export function getModelLabel(
  modelOption: CloudTaskConfigOption,
  value: string,
): string {
  return (
    modelOption.options.find((option) => option.value === value)?.name ?? value
  );
}

export function resolveAvailableModel(
  modelOption: CloudTaskConfigOption,
  value: string,
): string {
  const selectedOption = modelOption.options.find(
    (option) => option.value === value,
  );
  if (selectedOption && !isRestrictedModelOption(selectedOption._meta)) {
    return value;
  }
  return modelOption.currentValue;
}
