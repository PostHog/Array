import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import { Popover, PopoverTrigger } from "@posthog/quill";
import { RecentsHoverCard } from "@posthog/ui/features/canvas/components/RecentsHoverCard";
import { useState } from "react";
import { SidebarItem } from "../SidebarItem";

export function RecentsItem({
  depth = 0,
  onClick,
}: {
  depth?: number;
  onClick: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item = (
    <SidebarItem
      depth={depth}
      icon={<ClockCounterClockwiseIcon size={16} />}
      label="Recents"
      isActive={false}
      onClick={() => {
        onClick();
        setOpen((value) => !value);
      }}
    />
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger openOnHover delay={300} closeDelay={100} render={item} />
      {open && <RecentsHoverCard onClose={() => setOpen(false)} />}
    </Popover>
  );
}
