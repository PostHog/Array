import { ExitIcon } from "@radix-ui/react-icons";
import {
  Button,
  Code,
  DropdownMenu,
  Flex,
  Switch,
  Text,
} from "@radix-ui/themes";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore } from "../stores/themeStore";

export function StatusBarMenu() {
  const isDarkMode = useThemeStore((state) => state.isDarkMode);
  const toggleDarkMode = useThemeStore((state) => state.toggleDarkMode);
  const logout = useAuthStore((state) => state.logout);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button size="1" variant="ghost">
          <Code size="1" color="gray" variant="ghost">
            ARRAY
          </Code>
        </Button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content>
        <DropdownMenu.Item
          onSelect={(e) => {
            e.preventDefault();
            toggleDarkMode();
          }}
          className="px-1"
        >
          <Flex align="center" justify="between" gap="4">
            <Text size="2">Dark Mode</Text>
            <Switch
              checked={isDarkMode}
              onCheckedChange={toggleDarkMode}
              size="1"
            />
          </Flex>
        </DropdownMenu.Item>

        <DropdownMenu.Separator className="mx-1" />

        <DropdownMenu.Item onSelect={logout} className="px-1">
          <Flex align="center" gap="2">
            <ExitIcon />
            <Text size="2">Logout</Text>
          </Flex>
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
