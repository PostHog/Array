import { Flex, Select, Text } from "@radix-ui/themes";
import { IS_DEV } from "@shared/constants/environment";
import type { CloudRegion } from "@shared/types/regions";

interface RegionSelectProps {
  region: CloudRegion;
  onRegionChange: (region: CloudRegion) => void;
  disabled?: boolean;
}

interface RegionOption {
  value: CloudRegion;
  flag: string;
  label: string;
  hint: string;
}

const REGION_OPTIONS: RegionOption[] = [
  {
    value: "us",
    flag: "\u{1F1FA}\u{1F1F8}", // US flag
    label: "US Cloud",
    hint: "us.posthog.com",
  },
  {
    value: "eu",
    flag: "\u{1F1EA}\u{1F1FA}", // EU flag
    label: "EU Cloud",
    hint: "eu.posthog.com",
  },
];

export function RegionSelect({
  region,
  onRegionChange,
  disabled = false,
}: RegionSelectProps) {
  return (
    <Flex direction="column" gap="2" className="w-full">
      <Flex justify="between" align="center">
        <Text className="font-medium text-(--gray-12) text-sm">
          PostHog region
        </Text>
        <Text className="text-(--gray-11) text-xs">
          Pick where your account lives
        </Text>
      </Flex>
      <div className="grid w-full grid-cols-2 gap-2">
        {REGION_OPTIONS.map((option) => {
          const isSelected = option.value === region;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onRegionChange(option.value)}
              disabled={disabled}
              className={`flex w-full flex-col items-start gap-[2px] rounded-[8px] border-[1.5px] px-3 py-2 text-left transition-colors ${
                isSelected
                  ? "border-(--accent-9) bg-(--accent-3) text-(--gray-12)"
                  : "border-(--gray-6) bg-transparent text-(--gray-12) hover:border-(--gray-8)"
              } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <Flex align="center" gap="2" className="w-full">
                <span className="text-[18px] leading-none">{option.flag}</span>
                <Text className="font-semibold text-(--gray-12) text-sm">
                  {option.label}
                </Text>
              </Flex>
              <Text className="pl-[26px] text-(--gray-11) text-xs">
                {option.hint}
              </Text>
            </button>
          );
        })}
      </div>
      {IS_DEV && (
        <Flex direction="column" gap="1" className="mt-1 w-full">
          <Text className="text-(--gray-11) text-xs">Development override</Text>
          <Select.Root
            value={region}
            onValueChange={(value) => onRegionChange(value as CloudRegion)}
            size="2"
            disabled={disabled}
          >
            <Select.Trigger />
            <Select.Content>
              <Select.Item value="us">US Cloud</Select.Item>
              <Select.Item value="eu">EU Cloud</Select.Item>
              <Select.Item value="dev">Development</Select.Item>
            </Select.Content>
          </Select.Root>
        </Flex>
      )}
    </Flex>
  );
}
