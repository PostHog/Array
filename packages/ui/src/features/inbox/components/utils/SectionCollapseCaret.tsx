import { CaretDownIcon } from "@phosphor-icons/react";
import { cn } from "@posthog/quill";

/**
 * Disclosure caret for collapsible detail sections – points down when the
 * section is open, right when it is collapsed. Shared by `DetailSection` and
 * `RightColumnSection` so both column styles read the same way.
 */
export function SectionCollapseCaret({
  open,
  size = 12,
}: {
  open: boolean;
  size?: number;
}) {
  return (
    <CaretDownIcon
      size={size}
      aria-hidden
      className={cn(
        "shrink-0 text-(--gray-9) transition-transform",
        !open && "-rotate-90",
      )}
    />
  );
}
