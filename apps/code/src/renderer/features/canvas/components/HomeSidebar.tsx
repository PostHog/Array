import { useWebsiteTasksStore } from "@features/canvas/stores/websiteTasksStore";
import { useTasks } from "@features/tasks/hooks/useTasks";
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@posthog/quill";
import { Box, Flex, Text } from "@radix-ui/themes";
import { useNavigate, useRouterState } from "@tanstack/react-router";

// Fake placeholder groups kept below the real Website section for continuity.
type HomeNavItem = { id: string; label: string };
type HomeNavGroup = { id: string; label: string; items: HomeNavItem[] };

const PLACEHOLDER_NAV: HomeNavGroup[] = [
  {
    id: "features",
    label: "Features",
    items: [
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

function NavButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <Button
      variant="default"
      size="sm"
      data-selected={active}
      disabled={disabled}
      onClick={onClick}
      className="w-full justify-start"
    >
      {label}
    </Button>
  );
}

function WebsiteSection() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const taskIds = useWebsiteTasksStore((s) => s.taskIds);
  const { data: tasks } = useTasks();

  return (
    <Collapsible variant="folder" defaultOpen>
      <CollapsibleTrigger>Website</CollapsibleTrigger>
      <CollapsibleContent>
        <Flex direction="column" gap="1" pt="1">
          <NavButton
            label="Canvas"
            active={pathname === "/website"}
            onClick={() => navigate({ to: "/website" })}
          />
          <NavButton
            label="New task"
            active={pathname === "/website/new"}
            onClick={() => navigate({ to: "/website/new" })}
          />
          <NavButton
            label="Settings"
            active={pathname.startsWith("/website/settings")}
            onClick={() => navigate({ to: "/website/settings" })}
          />
          {taskIds.length > 0 && (
            <Text size="1" className="px-2 pt-2 text-gray-9">
              Tasks
            </Text>
          )}
          {taskIds.map((taskId) => {
            const title = tasks?.find((t) => t.id === taskId)?.title;
            return (
              <NavButton
                key={taskId}
                label={title || "Untitled task"}
                active={pathname === `/website/tasks/${taskId}`}
                onClick={() =>
                  navigate({
                    to: "/website/tasks/$taskId",
                    params: { taskId },
                  })
                }
              />
            );
          })}
        </Flex>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function HomeSidebar() {
  return (
    <Box
      className="h-full shrink-0 border-gray-6 border-r bg-gray-1"
      style={{ width: 240, minWidth: 240 }}
    >
      <Flex direction="column" gap="2" p="2">
        <Text size="2" weight="bold" className="px-1 text-gray-12">
          Home
        </Text>

        <WebsiteSection />

        {PLACEHOLDER_NAV.map((group) => (
          <Collapsible key={group.id} variant="folder" defaultOpen>
            <CollapsibleTrigger>{group.label}</CollapsibleTrigger>
            <CollapsibleContent>
              <Flex direction="column" gap="1" pt="1">
                {group.items.map((item) => (
                  <NavButton key={item.id} label={item.label} disabled />
                ))}
              </Flex>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </Flex>
    </Box>
  );
}
