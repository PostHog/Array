import {
  Bell,
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
  type CustomizableNavItemId,
  isNavItemVisible,
} from "@posthog/ui/features/sidebar/constants";
import { useSidebarStore } from "@posthog/ui/features/sidebar/sidebarStore";
import { track } from "@posthog/ui/shell/analytics";
import { Button, Checkbox, Dialog, Flex, Text } from "@radix-ui/themes";

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
          {CUSTOMIZABLE_NAV_ITEMS.filter(
            ({ id }) => available?.[id] !== false,
          ).map(({ id, label, analyticsId }) => {
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
                        item: analyticsId,
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
            <Button size="1" variant="solid">
              Done
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
