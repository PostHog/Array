import { useSettingsPageStore } from "@features/settings/stores/settingsPageStore";
import { Cloud, HardDrives } from "@phosphor-icons/react";
import { Flex, SegmentedControl, Text } from "@radix-ui/themes";
import { navigateToSettings } from "@renderer/navigationBridge";
import { useRouterState } from "@tanstack/react-router";
import { CloudEnvironmentsSettings } from "./CloudEnvironmentsSettings";
import { LocalEnvironmentsSettings } from "./LocalEnvironmentsSettings";

type Segment = "local" | "cloud";

export function EnvironmentsSettings() {
  const formMode = useSettingsPageStore((s) => s.formMode);
  // Read category from the URL — falls back to "environments" when the
  // component is rendered outside a router shell (e.g. AiApprovalScreen).
  const activeCategory = useRouterState({
    select: (s) => {
      const match = s.matches.find((m) => m.routeId === "/settings/$category");
      const params = match?.params as { category?: string } | undefined;
      return params?.category ?? "environments";
    },
  });

  const segment: Segment =
    activeCategory === "cloud-environments" ? "cloud" : "local";

  const handleSegmentChange = (value: string) => {
    navigateToSettings(
      value === "cloud" ? "cloud-environments" : "environments",
    );
  };

  return (
    <Flex direction="column" gap="4">
      {!formMode && (
        <>
          <Text color="gray" className="text-[13px]">
            An environment defines what the agent works inside when you start a
            task.{" "}
            <Text color="gray" className="font-medium text-[13px]">
              Local
            </Text>{" "}
            environments prepare a project on your machine;{" "}
            <Text color="gray" className="font-medium text-[13px]">
              cloud
            </Text>{" "}
            environments configure remote sandboxes.
          </Text>
          <SegmentedControl.Root
            value={segment}
            onValueChange={handleSegmentChange}
            size="2"
          >
            <SegmentedControl.Item value="local">
              <Flex align="center" gap="2">
                <HardDrives size={14} />
                <Text>Local</Text>
              </Flex>
            </SegmentedControl.Item>
            <SegmentedControl.Item value="cloud">
              <Flex align="center" gap="2">
                <Cloud size={14} />
                <Text>Cloud</Text>
              </Flex>
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        </>
      )}

      {segment === "cloud" ? (
        <CloudEnvironmentsSettings />
      ) : (
        <LocalEnvironmentsSettings />
      )}
    </Flex>
  );
}
