import type { IconProps } from "@phosphor-icons/react";
import { SectionCollapseCaret } from "@posthog/ui/features/inbox/components/utils/SectionCollapseCaret";
import { Flex, Text } from "@radix-ui/themes";
import type { ComponentType, ReactNode } from "react";
import { useState } from "react";

interface DetailSectionProps {
  Icon: ComponentType<IconProps>;
  title: string;
  /**
   * Controls rendered at the end of the header row. Kept outside the collapse
   * toggle so its own click targets stay independently usable.
   */
  rightSlot?: ReactNode;
  /** When set, the icon + title row toggles the body open and closed. */
  collapsible?: boolean;
  /** Start collapsed. Only honoured together with `collapsible`. */
  defaultCollapsed?: boolean;
  children: ReactNode;
}

/**
 * Main-column content section: icon + title, a spanning divider, then the
 * body. Pass `collapsible` to turn the header into a disclosure button – the
 * divider and `rightSlot` keep their geometry either way, so a collapsible
 * section sits on the same baseline as a static one.
 */
export function DetailSection({
  Icon,
  title,
  rightSlot,
  collapsible = false,
  defaultCollapsed = false,
  children,
}: DetailSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const open = !collapsible || !collapsed;

  const header = (
    <>
      <Flex align="center" gap="2" className="min-w-0">
        <Icon size={15} weight="bold" className="shrink-0 text-gray-11" />
        <Text className="truncate font-semibold text-[14px] text-gray-12 tracking-[-0.01em]">
          {title}
        </Text>
      </Flex>
      <div className="h-px min-w-4 flex-1 bg-(--gray-5)" />
      {collapsible && <SectionCollapseCaret open={open} />}
    </>
  );

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="3" className="min-w-0 select-none">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setCollapsed((prev) => !prev)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 border-0 bg-transparent p-0 text-left"
          >
            {header}
          </button>
        ) : (
          <Flex
            align="center"
            gap="3"
            className="min-w-0 flex-1 cursor-default"
          >
            {header}
          </Flex>
        )}
        {rightSlot && <div className="shrink-0">{rightSlot}</div>}
      </Flex>
      {open && <div>{children}</div>}
    </Flex>
  );
}
