import { WebsiteCanvas } from "@features/canvas/components/WebsiteCanvas";
import { getDashboard } from "@features/canvas/dashboards";
import { useIsDashboardEditing } from "@features/canvas/stores/dashboardEditStore";
import { TrendDownIcon, TrendUpIcon } from "@phosphor-icons/react";
import { Box, Flex, Grid, ScrollArea, Text } from "@radix-ui/themes";

// Renders a mock website dashboard (stat tiles) for the active dashboard id.
// In edit mode, swaps to the gen-UI canvas + chat for that dashboard's thread.
export function WebsiteDashboard({ dashboardId }: { dashboardId?: string }) {
  const dashboard = getDashboard(dashboardId);
  const editing = useIsDashboardEditing(dashboard.id);

  if (editing) {
    return <WebsiteCanvas threadId={`dashboard:${dashboard.id}`} />;
  }

  return (
    <ScrollArea className="h-full bg-gray-1">
      <Grid
        columns={{ initial: "1", sm: "2", md: "4" }}
        gap="3"
        p="5"
        width="auto"
      >
        {dashboard.tiles.map((tile) => (
          <Box
            key={tile.label}
            className="rounded-lg border border-gray-6 bg-gray-2 p-4"
          >
            <Text size="1" className="text-gray-10">
              {tile.label}
            </Text>
            <Text size="7" weight="bold" as="div" className="mt-1 text-gray-12">
              {tile.value}
            </Text>
            {tile.delta && (
              <Flex
                align="center"
                gap="1"
                mt="1"
                className={
                  tile.trend === "down" ? "text-red-11" : "text-green-11"
                }
              >
                {tile.trend === "down" ? (
                  <TrendDownIcon size={12} />
                ) : (
                  <TrendUpIcon size={12} />
                )}
                <Text size="1">{tile.delta}</Text>
              </Flex>
            )}
          </Box>
        ))}

        <Box
          className="rounded-lg border border-gray-6 border-dashed bg-gray-2 p-4 md:col-span-4"
          style={{ height: 220 }}
        >
          <Text size="1" className="text-gray-10">
            {dashboard.name} · trend
          </Text>
          <Flex align="center" justify="center" className="h-full">
            <Text size="2" className="text-gray-8">
              Chart placeholder
            </Text>
          </Flex>
        </Box>
      </Grid>
    </ScrollArea>
  );
}
