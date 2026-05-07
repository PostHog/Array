import { useSettingsDialogStore } from "@features/settings/stores/settingsDialogStore";
import { Cloud, HardDrives } from "@phosphor-icons/react";
import { Flex, SegmentedControl, Text } from "@radix-ui/themes";
import { CloudEnvironmentsSettings } from "./CloudEnvironmentsSettings";
import { LocalEnvironmentsSettings } from "./LocalEnvironmentsSettings";

type Segment = "local" | "cloud";

export function EnvironmentsSettings() {
  const activeCategory = useSettingsDialogStore((s) => s.activeCategory);
  const setCategory = useSettingsDialogStore((s) => s.setCategory);
  const formMode = useSettingsDialogStore((s) => s.formMode);

  const segment: Segment =
    activeCategory === "cloud-environments" ? "cloud" : "local";

  const handleSegmentChange = (value: string) => {
    setCategory(value === "cloud" ? "cloud-environments" : "environments");
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
