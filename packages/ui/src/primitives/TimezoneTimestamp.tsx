import { TimezoneConversionTooltip } from "./TimezoneConversionTooltip";

interface TimezoneTimestampProps {
  timestamp: string | number | Date;
  timezone: string;
  label?: string;
  className?: string;
}

export function TimezoneTimestamp({
  timestamp,
  timezone,
  label,
  className,
}: TimezoneTimestampProps) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  let displayLabel = label;
  if (!displayLabel) {
    try {
      displayLabel = new Intl.DateTimeFormat(undefined, {
        timeZone: timezone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      }).format(date);
    } catch {
      displayLabel = date.toLocaleString();
    }
  }

  return (
    <TimezoneConversionTooltip timestamp={date} timezone={timezone}>
      <span
        className={`cursor-help font-medium underline decoration-dotted underline-offset-2 ${className ?? ""}`}
      >
        {displayLabel}
      </span>
    </TimezoneConversionTooltip>
  );
}
