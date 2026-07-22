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
  CUSTOMIZABLE_NAV_ITEMS,
  type CustomizableNavItem,
  type CustomizableNavItemId,
  isNavItemVisible,
  moveNavItem,
  orderedNavItems,
} from "@posthog/ui/features/sidebar/constants";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { track } from "@posthog/ui/shell/analytics";
import { Button, Checkbox, Dialog, Flex, Text } from "@radix-ui/themes";
import { type RefCallback, useRef, useState } from "react";

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

  // Dragover only moves this local preview. Committing to the store per
  // dragover would serialize it to localStorage and re-render the live
  // sidebar on every pointer move, which made dragging visibly lag; the
  // store commits once on drop and a canceled drag just drops the preview.
  const previewRef = useRef<readonly CustomizableNavItemId[] | null>(null);
  const [previewOrder, setPreviewOrder] = useState<
    readonly CustomizableNavItemId[] | null
  >(null);
  const updatePreview = (order: readonly CustomizableNavItemId[] | null) => {
    previewRef.current = order;
    setPreviewOrder(order);
  };
  // dragover can re-fire for the same source/target pair while the pointer
  // sits on a row boundary; replaying the move would swap the rows back.
  const lastMove = useRef<string | null>(null);

  const items = orderedNavItems(previewOrder ?? navItemOrder).filter(
    ({ id }) => available?.[id] !== false,
  );

  const handleDragStart: DragDropEvents["dragstart"] = () => {
    lastMove.current = null;
    updatePreview(
      orderedNavItems(useSidebarStore.getState().navItemOrder).map(
        (item) => item.id,
      ),
    );
  };

  const handleDragOver: DragDropEvents["dragover"] = (event) => {
    const sourceId = event.operation.source?.id;
    const targetId = event.operation.target?.id;
    const current = previewRef.current;
    if (!current || !sourceId || !targetId || sourceId === targetId) return;
    const moveKey = `${String(sourceId)}->${String(targetId)}`;
    if (lastMove.current === moveKey) return;
    const next = moveNavItem(current, String(sourceId), String(targetId));
    if (next !== current) {
      lastMove.current = moveKey;
      updatePreview(next);
    }
  };

  const handleDragEnd: DragDropEvents["dragend"] = (event) => {
    const preview = previewRef.current;
    updatePreview(null);
    if (event.canceled || !preview) return;
    const stored = orderedNavItems(useSidebarStore.getState().navItemOrder).map(
      (item) => item.id,
    );
    if (sameOrder(stored, preview)) return;
    setNavItemOrder(preview);
    const moved = CUSTOMIZABLE_NAV_ITEMS.find(
      ({ id }) => id === event.operation.source?.id,
    );
    if (!moved) return;
    track(ANALYTICS_EVENTS.SIDEBAR_REORDERED, {
      item: moved.analyticsId,
      to_index: preview.indexOf(moved.id),
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

        {/* Default pointer activation starts a mouse drag from the handle
            immediately; a distance constraint here would delay pickup. */}
        <DragDropProvider
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
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

        <Flex mt="4" justify="between" align="center">
          <Button
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => setNavItemOrder([])}
          >
            Reset
          </Button>
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
