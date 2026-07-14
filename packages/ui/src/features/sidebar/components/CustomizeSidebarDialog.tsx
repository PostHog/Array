import {
  Bell,
  CreditCard,
  Lightbulb,
  Lightning,
  MagnifyingGlass,
  Plugs,
  Robot,
} from "@phosphor-icons/react";
import {
  ANALYTICS_EVENTS,
  type SidebarNavItem,
} from "@posthog/shared/analytics-events";
import {
  isNavItemVisible,
  MORE_NAV_ITEMS,
  type MoreNavItemId,
} from "@posthog/ui/features/sidebar/constants";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { track } from "@posthog/ui/shell/analytics";
import { Button, Checkbox, Dialog, Flex, Text } from "@radix-ui/themes";
import { SquircleDashed } from "lucide-react";

const ITEM_ICONS: Record<
  MoreNavItemId,
  React.ComponentType<{ size?: number | string }>
> = {
  search: MagnifyingGlass,
  agents: Robot,
  skills: Lightbulb,
  "mcp-servers": Plugs,
  usage: CreditCard,
  "command-center": Lightning,
  contexts: SquircleDashed,
  activity: Bell,
};

const ITEM_ANALYTICS_IDS: Record<MoreNavItemId, SidebarNavItem> = {
  search: "search",
  agents: "agents",
  skills: "skills",
  "mcp-servers": "mcp_servers",
  usage: "usage",
  "command-center": "command_center",
  contexts: "contexts",
  activity: "activity",
};

interface CustomizeSidebarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CustomizeSidebarDialog({
  open,
  onOpenChange,
}: CustomizeSidebarDialogProps) {
  const navItemOverrides = useSidebarStore((s) => s.navItemOverrides);
  const setNavItemVisible = useSidebarStore((s) => s.setNavItemVisible);

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
            const visible = isNavItemVisible(navItemOverrides, id);
            return (
              <Text key={id} as="label" size="2">
                <Flex gap="2" align="center">
                  <Checkbox
                    checked={visible}
                    onCheckedChange={(checked) => {
                      const nextVisible = checked === true;
                      setNavItemVisible(id, nextVisible);
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
