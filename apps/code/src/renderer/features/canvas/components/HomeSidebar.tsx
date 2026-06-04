import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@posthog/quill";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";

// `to` is a literal union of real canvas routes so navigate() stays type-safe.
// Items without `to` are placeholders (fake nav) and don't navigate yet. Widen
// the union as canvas routes are added.
type HomeNavRoute = "/website";

type HomeNavItem = {
  id: string;
  label: string;
  to?: HomeNavRoute;
};

type HomeNavGroup = {
  id: string;
  label: string;
  items: HomeNavItem[];
};

const HOME_NAV: HomeNavGroup[] = [
  {
    id: "features",
    label: "Features",
    items: [
      { id: "website", label: "Website", to: "/website" },
      { id: "app", label: "App" },
      { id: "mobile", label: "Mobile" },
    ],
  },
  {
    id: "resources",
    label: "Resources",
    items: [
      { id: "docs", label: "Docs" },
      { id: "changelog", label: "Changelog" },
    ],
  },
];

export function HomeSidebar() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <Box
      className="h-full shrink-0 border-gray-6 border-r bg-gray-1"
      style={{ width: 240, minWidth: 240 }}
    >
      <Flex direction="column" gap="2" p="2">
        <Text size="2" weight="bold" className="px-1 text-gray-12">
          Home
        </Text>

        {HOME_NAV.map((group) => (
          <Collapsible key={group.id} variant="folder" defaultOpen>
            <CollapsibleTrigger>{group.label}</CollapsibleTrigger>
            <CollapsibleContent>
              <Flex direction="column" gap="1" pt="1">
                {group.items.map((item) => {
                  const active = item.to != null && pathname === item.to;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={item.to == null}
                      onClick={() => item.to && navigate({ to: item.to })}
                      className={`flex w-full items-center rounded-md px-2 py-1.5 text-left text-[13px] transition-colors ${
                        active
                          ? "bg-accent-4 text-accent-12"
                          : "text-gray-11 hover:bg-gray-3 disabled:cursor-default disabled:text-gray-8 disabled:hover:bg-transparent"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </Flex>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </Flex>
    </Box>
  );
}
