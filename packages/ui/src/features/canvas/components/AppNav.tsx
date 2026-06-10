import { CodeIcon, HashIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Box, Flex } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";

type AppNavItem = {
  id: "code" | "channels";
  label: string;
  icon: typeof CodeIcon;
  to: "/code" | "/website";
  isActive: (pathname: string) => boolean;
};

// Slack-like app rail switching between top-level "spaces": Code (the existing
// task app) and Channels (the website space with its channel list + dashboards).
// Gated behind project-bluebird in __root.
const NAV_ITEMS: AppNavItem[] = [
  {
    id: "code",
    label: "Code",
    icon: CodeIcon,
    to: "/code",
    isActive: (pathname) =>
      pathname === "/code" || pathname.startsWith("/code/"),
  },
  {
    id: "channels",
    label: "Channels",
    icon: HashIcon,
    to: "/website",
    isActive: (pathname) =>
      pathname === "/website" || pathname.startsWith("/website/"),
  },
];

export function AppNav() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Flex
      direction="column"
      align="center"
      gap="2"
      className="drag h-full shrink-0 border-gray-6 border-r bg-gray-2 px-2 pt-10 pb-2"
    >
      {NAV_ITEMS.map((item) => {
        const active = item.isActive(pathname);
        const Icon = item.icon;
        return (
          <Box key={item.id} position="relative" className="no-drag">
            <Button
              size="icon-lg"
              variant="default"
              aria-selected={active}
              aria-label={item.label}
              title={item.label}
              onClick={() => navigate({ to: item.to })}
            >
              <Icon size={20} weight="regular" />
            </Button>
          </Box>
        );
      })}
    </Flex>
  );
}
