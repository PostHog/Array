import { CodeIcon, HouseIcon } from "@phosphor-icons/react";
import { Button } from "@posthog/quill";
import { Flex } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { isMac } from "@utils/platform";

// macOS draws the traffic lights over the top-left of the window
// (titleBarStyle: hiddenInset). Reserve space so the first rail button clears
// them.
const MAC_TRAFFIC_LIGHT_INSET = 28;

type CanvasNavItem = {
  id: "home" | "code";
  label: string;
  icon: typeof HouseIcon;
  to: "/" | "/code";
  isActive: (pathname: string) => boolean;
};

// Slack-like app rail. Each entry switches between top-level "spaces": Home
// (the / hello-world scene with its own sidenav) and Code (the existing
// /code app). New spaces register here.
const NAV_ITEMS: CanvasNavItem[] = [
  {
    id: "home",
    label: "Home",
    icon: HouseIcon,
    to: "/",
    isActive: (pathname) => pathname === "/",
  },
  {
    id: "code",
    label: "Code",
    icon: CodeIcon,
    to: "/code",
    isActive: (pathname) =>
      pathname === "/code" || pathname.startsWith("/code/"),
  },
];

export function CanvasNav() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Flex
      direction="column"
      align="center"
      gap="2"
      p="2"
      className="drag h-full shrink-0 border-gray-6 border-r bg-gray-2"
      style={{ paddingTop: isMac ? MAC_TRAFFIC_LIGHT_INSET : undefined }}
    >
      {NAV_ITEMS.map((item) => {
        const active = item.isActive(pathname);
        const Icon = item.icon;
        return (
          <Button
            key={item.id}
            className="no-drag"
            size="icon-lg"
            variant="default"
            aria-selected={active}
            aria-label={item.label}
            title={item.label}
            onClick={() => navigate({ to: item.to })}
          >
            <Icon size={20} weight="regular" />
          </Button>
        );
      })}
    </Flex>
  );
}
