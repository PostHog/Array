import {
  type Icon,
  Lightbulb,
  MagnifyingGlass,
  Plugs,
} from "@phosphor-icons/react";
import {
  ANALYTICS_EVENTS,
  type SidebarNavItem,
} from "@posthog/shared/analytics-events";
import {
  MORE_NAV_ITEMS,
  type MoreNavItemId,
} from "@posthog/ui/features/sidebar/constants";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { track } from "@posthog/ui/shell/analytics";
import { Button, Checkbox, Dialog, Flex, Text } from "@radix-ui/themes";

const ITEM_ICONS: Record<MoreNavItemId, Icon> = {
  search: MagnifyingGlass,
  skills: Lightbulb,
  "mcp-servers": Plugs,
};

const ITEM_ANALYTICS_IDS: Record<MoreNavItemId, SidebarNavItem> = {
  search: "search",
  skills: "skills",
  "mcp-servers": "mcp_servers",
};

interface CustomizeSidebarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CustomizeSidebarDialog({
  open,
  onOpenChange,
}: CustomizeSidebarDialogProps) {
  const hiddenNavItems = useSidebarStore((s) => s.hiddenNavItems);
  const setNavItemHidden = useSidebarStore((s) => s.setNavItemHidden);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="360px">
        <Dialog.Title>Customize sidebar</Dialog.Title>
        <Dialog.Description className="text-gray-10 text-sm">
          Choose which items appear in your sidebar. Unchecked items live under
          More.
        </Dialog.Description>

        <Flex direction="column" gap="3" mt="4">
          {MORE_NAV_ITEMS.map(({ id, label }) => {
            const ItemIcon = ITEM_ICONS[id];
            const visible = !hiddenNavItems.includes(id);
            return (
              <Text key={id} as="label" size="2">
                <Flex gap="2" align="center">
                  <Checkbox
                    checked={visible}
                    onCheckedChange={(checked) => {
                      const nextVisible = checked === true;
                      setNavItemHidden(id, !nextVisible);
                      track(ANALYTICS_EVENTS.SIDEBAR_CUSTOMIZED, {
                        item: ITEM_ANALYTICS_IDS[id],
                        visible: nextVisible,
                      });
                    }}
                  />
                  <ItemIcon size={16} />
                  {label}
                </Flex>
              </Text>
            );
          })}
        </Flex>

        <Flex mt="4" justify="end">
          <Dialog.Close>
            <Button variant="solid">Done</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
