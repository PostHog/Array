import { isHomeSpacePath } from "@features/canvas/spaces";
import { useInboxSignalCount } from "@features/inbox/hooks/useInboxSignalCount";
import { CodeIcon, HouseIcon, TrayIcon } from "@phosphor-icons/react";
import { Badge, Button } from "@posthog/quill";
import { Box, Flex } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { isMac } from "@utils/platform";

// macOS draws the traffic lights over the top-left of the window
// (titleBarStyle: hiddenInset). Reserve space so the first rail button clears
// them.
const MAC_TRAFFIC_LIGHT_INSET = 28;

type CanvasNavItem = {
  id: "home" | "inbox" | "code";
  label: string;
  icon: typeof HouseIcon;
  to: "/" | "/inbox" | "/code";
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
    isActive: (pathname) => isHomeSpacePath(pathname),
  },
  {
    id: "inbox",
    label: "Inbox",
    icon: TrayIcon,
    to: "/inbox",
    isActive: (pathname) => pathname === "/inbox",
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

function formatBadgeCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function CanvasNav() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inboxCount = useInboxSignalCount();

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
        const badgeCount = item.id === "inbox" ? inboxCount : 0;
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
            {badgeCount > 0 && (
              <Badge
                variant="destructive"
                className="-top-1 -right-1 pointer-events-none absolute min-w-4 justify-center rounded-full px-1 tabular-nums"
                title={`${badgeCount} actionable report${badgeCount === 1 ? "" : "s"}`}
              >
                {formatBadgeCount(badgeCount)}
              </Badge>
            )}
          </Box>
        );
      })}
    </Flex>
  );
}
