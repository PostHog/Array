import type { IconProps } from "@phosphor-icons/react";
import { SectionCollapseCaret } from "@posthog/ui/features/inbox/components/utils/SectionCollapseCaret";
import { Flex, Text } from "@radix-ui/themes";
import type { ComponentType, ReactNode } from "react";
import { useState } from "react";

interface RightColumnSectionProps {
  Icon: ComponentType<IconProps>;
  title: string;
  /**
   * Controls rendered at the end of the caption row. Kept outside the collapse
   * toggle so its own click targets stay independently usable.
   */
  rightSlot?: ReactNode;
  /** When set, the caption toggles the body open and closed. */
  collapsible?: boolean;
  /** Start collapsed. Only honoured together with `collapsible`. */
  defaultCollapsed?: boolean;
  children: ReactNode;
}

/**
 * Slim caption header used by every section in the detail-view right column.
 * Smaller and lighter than `DetailSection` (no spanning divider) so the
 * side column reads as supporting detail rather than competing with the
 * main Summary on the left. Pass `collapsible` to turn the caption into a
 * disclosure button.
 */
export function RightColumnSection({
  Icon,
  title,
  rightSlot,
  collapsible = false,
  defaultCollapsed = false,
  children,
}: RightColumnSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const open = !collapsible || !collapsed;

  const caption = (
    <>
      <Icon size={12} className="shrink-0" />
      <Text className="font-medium text-[11px] uppercase tracking-[0.06em]">
        {title}
      </Text>
      {collapsible && <SectionCollapseCaret open={open} size={10} />}
    </>
  );

  return (
    <Flex direction="column" gap="2">
      <Flex
        align="center"
        justify="between"
        gap="2"
        className="select-none text-gray-10"
      >
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setCollapsed((prev) => !prev)}
            className="flex min-w-0 cursor-pointer items-center gap-2 border-0 bg-transparent p-0 text-left text-gray-10 transition-colors hover:text-gray-11"
          >
            {caption}
          </button>
        ) : (
          <Flex align="center" gap="2" className="min-w-0 cursor-default">
            {caption}
          </Flex>
        )}
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </Flex>
      {open && <div>{children}</div>}
    </Flex>
  );
}
