import {
  ThreadItemTimestamp,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@posthog/quill";

function ordinal(value: number): string {
  const remainder = value % 100;
  const suffixes = ["th", "st", "nd", "rd"];
  return `${value}${suffixes[(remainder - 20) % 10] ?? suffixes[remainder] ?? suffixes[0]}`;
}

function formatClock(date: Date): string {
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const meridiem = date.getHours() >= 12 ? "pm" : "am";
  const hour = date.getHours() % 12 || 12;
  return `${hour}:${minutes}${meridiem}`;
}

function formatTooltip(date: Date): string {
  const month = date.toLocaleString("en-US", { month: "long" });
  return `${month} ${ordinal(date.getDate())} at ${formatClock(date)}`;
}

// `className` is the only styling seam that reaches the rendered element:
// `TooltipTrigger` replaces the wrapped element's `data-slot` with its own, so an
// ancestor `[data-slot=thread-item-timestamp]` rule never matches it.
export function ThreadTimestamp({
  dateTime,
  className,
}: {
  dateTime: string;
  className?: string;
}) {
  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) return null;

  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadItemTimestamp dateTime={dateTime} className={className}>
              {formatClock(date)}
            </ThreadItemTimestamp>
          }
        />
        <TooltipContent side="top">{formatTooltip(date)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
