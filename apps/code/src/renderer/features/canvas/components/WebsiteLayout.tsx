import { useTasks } from "@features/tasks/hooks/useTasks";
import { CaretRightIcon } from "@phosphor-icons/react";
import { Box, Flex, Text } from "@radix-ui/themes";
import {
  Link,
  Outlet,
  useParams,
  useRouterState,
} from "@tanstack/react-router";

type Crumb = { label: string; to?: string };

function useWebsiteCrumbs(): Crumb[] {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const params = useParams({ strict: false });
  const taskId = params.taskId;
  const { data: tasks } = useTasks();

  const root: Crumb = { label: "Website", to: "/website" };

  if (pathname.startsWith("/website/new")) {
    return [root, { label: "New task" }];
  }
  if (pathname.startsWith("/website/settings")) {
    return [root, { label: "Settings" }];
  }
  if (taskId) {
    const title = tasks?.find((t) => t.id === taskId)?.title;
    return [root, { label: title || "Task" }];
  }
  return [{ label: "Website" }];
}

// Breadcrumb topbar + content outlet for the Website space.
export function WebsiteLayout() {
  const crumbs = useWebsiteCrumbs();

  return (
    <Flex direction="column" height="100%" overflow="hidden">
      <Flex
        align="center"
        gap="1"
        px="3"
        className="drag h-9 shrink-0 border-gray-6 border-b"
      >
        {crumbs.map((crumb, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Flex key={crumb.label} align="center" gap="1">
              {i > 0 && <CaretRightIcon size={12} className="text-gray-8" />}
              {crumb.to && !isLast ? (
                <Link to={crumb.to} className="no-drag">
                  <Text size="1" className="text-gray-10 hover:text-gray-12">
                    {crumb.label}
                  </Text>
                </Link>
              ) : (
                <Text
                  size="1"
                  weight={isLast ? "medium" : "regular"}
                  className={isLast ? "text-gray-12" : "text-gray-10"}
                >
                  {crumb.label}
                </Text>
              )}
            </Flex>
          );
        })}
      </Flex>
      <Box flexGrow="1" overflow="hidden">
        <Outlet />
      </Box>
    </Flex>
  );
}
