import { Check, WarningCircle } from "@phosphor-icons/react";
import { Flex, Text, TextField } from "@radix-ui/themes";
import { parseSchedule } from "../utils/parseSchedule";

interface ScheduleFieldProps {
  value: string;
  onChange: (next: string) => void;
}

const QUICK_FILLS = [
  "Daily at 9am",
  "Weekdays at 9am",
  "Mondays at 9am",
  "Every hour",
  "1st of month at 9am",
];

export function ScheduleField({ value, onChange }: ScheduleFieldProps) {
  const trimmed = value.trim();
  const parsed = trimmed ? parseSchedule(trimmed) : null;
  const hasValue = trimmed.length > 0;
  const isValid = parsed !== null;

  return (
    <Flex direction="column" gap="2">
      <Text size="1" weight="medium" className="text-(--gray-11)">
        Schedule
      </Text>

      <TextField.Root
        size="2"
        placeholder="e.g. every Tuesday at 5pm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />

      {hasValue && isValid && (
        <Flex align="center" gap="2" className="text-(--green-11)">
          <Check size={12} />
          <Text size="1">→ {parsed.description}</Text>
        </Flex>
      )}
      {hasValue && !isValid && (
        <Flex align="center" gap="2" className="text-(--amber-11)">
          <WarningCircle size={12} />
          <Text size="1">
            Couldn't understand that — try "every Tuesday at 5pm", "daily at
            9am", "weekdays at 9am", or a cron expression.
          </Text>
        </Flex>
      )}

      <Flex direction="column" gap="1" className="pt-1">
        <Text
          size="1"
          weight="medium"
          className="text-(--gray-10) uppercase tracking-wider"
        >
          Quick fills
        </Text>
        <Flex gap="1" wrap="wrap">
          {QUICK_FILLS.map((label) => {
            const isActive = trimmed.toLowerCase() === label.toLowerCase();
            return (
              <button
                key={label}
                type="button"
                onClick={() => onChange(label)}
                className={`cursor-pointer rounded-full border px-3 py-1 text-[12px] transition-colors ${
                  isActive
                    ? "border-(--accent-7) bg-(--accent-3) text-(--gray-12)"
                    : "border-(--gray-5) bg-(--gray-2) text-(--gray-11) hover:bg-(--gray-3) hover:text-(--gray-12)"
                }`}
              >
                {label}
              </button>
            );
          })}
        </Flex>
      </Flex>
    </Flex>
  );
}
