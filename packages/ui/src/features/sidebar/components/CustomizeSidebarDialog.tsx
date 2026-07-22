import { PointerSensor } from "@dnd-kit/dom";
import { type DragDropEvents, DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import {
  Bell,
  DotsSixVertical,
  EnvelopeSimple,
  HashIcon,
  Lightbulb,
  Lightning,
  MagnifyingGlass,
  Plugs,
  RepeatIcon,
  Robot,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import { ANALYTICS_EVENTS } from "@posthog/shared/analytics-events";
import {
  type CustomizableNavItem,
  type CustomizableNavItemId,
  isNavItemVisible,
  moveNavItem,
  orderedNavItems,
} from "@posthog/ui/features/sidebar/constants";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { track } from "@posthog/ui/shell/analytics";
import { Button, Checkbox, Dialog, Flex, Text } from "@radix-ui/themes";
import { type RefCallback, useRef } from "react";

const ITEM_ICONS: Record<
  CustomizableNavItemId,
  React.ComponentType<{ size?: number | string }>
> = {
  search: MagnifyingGlass,
  inbox: EnvelopeSimple,
  agents: Robot,
  skills: Lightbulb,
  "mcp-servers": Plugs,
  "command-center": Lightning,
  contexts: HashIcon,
  activity: Bell,
  configure: SlidersHorizontal,
  loops: RepeatIcon,
};

function sameOrder(
  a: readonly CustomizableNavItemId[],
  b: readonly CustomizableNavItemId[],
): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

interface CustomizeSidebarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Items gated off by feature flags stay out of the dialog too, so it never
  // offers a checkbox for a nav row the user can't have.
  available?: Record<CustomizableNavItemId, boolean>;
}

export function CustomizeSidebarDialog({
  open,
  onOpenChange,
  available,
}: CustomizeSidebarDialogProps) {
  const navItemOverrides = useSidebarStore((s) => s.navItemOverrides);
  const navItemOrder = useSidebarStore((s) => s.navItemOrder);
  const setNavItemVisible = useSidebarStore((s) => s.setNavItemVisible);
  const setNavItemOrder = useSidebarStore((s) => s.setNavItemOrder);

  const items = orderedNavItems(navItemOrder).filter(
    ({ id }) => available?.[id] !== false,
  );

  // Dragover persists the reorder live so the list previews it, which means a
  // canceled drag must restore the order captured at dragstart.
  const initialOrder = useRef<readonly CustomizableNavItemId[] | null>(null);

  const handleDragStart: DragDropEvents["dragstart"] = () => {
    initialOrder.current = useSidebarStore.getState().navItemOrder;
  };

  const handleDragOver: DragDropEvents["dragover"] = (event) => {
    const sourceId = event.operation.source?.id;
    const targetId = event.operation.target?.id;
    if (!sourceId || !targetId || sourceId === targetId) return;
    const current = useSidebarStore.getState().navItemOrder;
    const next = moveNavItem(current, String(sourceId), String(targetId));
    if (next !== current) setNavItemOrder(next);
  };

  const handleDragEnd: DragDropEvents["dragend"] = (event) => {
    const before = initialOrder.current;
    initialOrder.current = null;
    if (event.canceled) {
      if (before) setNavItemOrder(before);
      return;
    }
    const after = useSidebarStore.getState().navItemOrder;
    if (before && sameOrder(before, after)) return;
    const sourceId = event.operation.source?.id;
    const moved = orderedNavItems(after).find(({ id }) => id === sourceId);
    if (!moved) return;
    track(ANALYTICS_EVENTS.SIDEBAR_REORDERED, {
      item: moved.analyticsId,
      to_index: orderedNavItems(after).findIndex(({ id }) => id === moved.id),
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="360px">
        <Dialog.Title>Customize sidebar</Dialog.Title>
        <Dialog.Description className="text-gray-10 text-sm">
          Choose which items appear in your sidebar and drag to reorder.
          Unchecked items live under More.
        </Dialog.Description>

        <DragDropProvider
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          sensors={[
            {
              plugin: PointerSensor,
              options: { activationConstraints: { distance: { value: 5 } } },
            },
          ]}
        >
          <Flex direction="column" gap="3" mt="4">
            {items.map((item, index) => (
              <SortableNavItemRow
                key={item.id}
                item={item}
                index={index}
                visible={isNavItemVisible(navItemOverrides, item.id)}
                onVisibleChange={(nextVisible) => {
                  setNavItemVisible(item.id, nextVisible);
                  track(ANALYTICS_EVENTS.SIDEBAR_CUSTOMIZED, {
                    item: item.analyticsId,
                    visible: nextVisible,
                  });
                }}
              />
            ))}
          </Flex>
        </DragDropProvider>

        <Flex mt="4" justify="end">
          <Dialog.Close>
            <Button size="1" variant="solid">
              Done
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function SortableNavItemRow({
  item,
  index,
  visible,
  onVisibleChange,
}: {
  item: CustomizableNavItem;
  index: number;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: item.id,
    index,
    group: "customize-sidebar-nav",
    transition: { duration: 200, easing: "ease" },
  });
  const ItemIcon = ITEM_ICONS[item.id];
  return (
    <div ref={ref} style={{ opacity: isDragging ? 0.5 : 1 }}>
      <Flex gap="2" align="center">
        <button
          ref={handleRef as RefCallback<HTMLButtonElement>}
          type="button"
          title="Drag to reorder"
          className="shrink-0 cursor-grab text-gray-9 hover:text-gray-11"
        >
          <DotsSixVertical size={14} />
        </button>
        <Text as="label" size="2" className="flex-1">
          <Flex gap="2" align="center">
            <Checkbox
              checked={visible}
              onCheckedChange={(checked) => onVisibleChange(checked === true)}
            />
            <ItemIcon size={16} />
            {item.label}
          </Flex>
        </Text>
      </Flex>
    </div>
  );
}
