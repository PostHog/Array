/**
 * Minimal stand-in for posthog's `lib/lemon-ui/LemonDropdown`: a controlled
 * popover anchored to its single child element, implemented with the
 * `@posthog/quill` popover primitives.
 */
import { Popover, PopoverContent, PopoverTrigger } from "@posthog/quill";
import type { JSX, ReactElement, ReactNode } from "react";

type Placement =
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "top-start"
  | "top-end"
  | "bottom-start"
  | "bottom-end"
  | "left-start"
  | "left-end"
  | "right-start"
  | "right-end";

export interface LemonDropdownProps {
  visible?: boolean;
  onVisibilityChange?: (visible: boolean) => void;
  overlay?: ReactNode;
  placement?: Placement;
  /** Accepted for API compatibility. The quill popover already stays open on inside clicks. */
  closeOnClickInside?: boolean;
  children: ReactElement;
}

export function LemonDropdown({
  visible,
  onVisibilityChange,
  overlay,
  placement = "bottom-start",
  closeOnClickInside: _closeOnClickInside,
  children,
}: LemonDropdownProps): JSX.Element {
  const [side, align] = placement.split("-") as [
    "top" | "bottom" | "left" | "right",
    "start" | "end" | undefined,
  ];
  return (
    <Popover open={visible} onOpenChange={(open) => onVisibilityChange?.(open)}>
      <PopoverTrigger render={children} />
      <PopoverContent side={side} align={align ?? "center"}>
        {overlay}
      </PopoverContent>
    </Popover>
  );
}
