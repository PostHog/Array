import { Badge } from "@components/ui/Badge";
import { ReportListRow } from "@features/inbox/components/list/ReportListRow";
import { useSetupStore } from "@features/setup/stores/setupStore";
import { discoveredTaskToSignalReport } from "@features/setup/utils/discoveredTaskToSignalReport";
import { SparkleIcon } from "@phosphor-icons/react";
import { Flex, Text, Tooltip } from "@radix-ui/themes";
import { useMemo } from "react";

interface RecommendedSetupTasksProps {
  onSelectTask: (taskId: string) => void;
}

export function RecommendedSetupTasks({
  onSelectTask,
}: RecommendedSetupTasksProps) {
  const tasks = useSetupStore((s) => s.discoveredTasks);
  const discoveryStatus = useSetupStore((s) => s.discoveryStatus);
  const selectedDiscoveredTaskId = useSetupStore(
    (s) => s.selectedDiscoveredTaskId,
  );

  const fakeReports = useMemo(
    () => tasks.map(discoveredTaskToSignalReport),
    [tasks],
  );

  if (tasks.length === 0) return null;

  return (
    <Flex direction="column">
      {discoveryStatus === "running" && (
        <Flex
          align="center"
          gap="1"
          className="border-b border-b-(--gray-5) bg-(--gray-2) px-3 py-1"
        >
          <Text size="1" className="text-(--gray-10) italic">
            scanning for more…
          </Text>
        </Flex>
      )}
      {fakeReports.map((report, index) => (
        <ReportListRow
          key={report.id}
          report={report}
          isSelected={selectedDiscoveredTaskId === report.id}
          showCheckbox={false}
          index={index}
          onClick={() => onSelectTask(report.id)}
          onToggleChecked={() => {}}
          iconOverride={
            <Tooltip content="Suggested by a local scan">
              <span className="text-(--violet-9)">
                <SparkleIcon size={14} weight="fill" />
              </span>
            </Tooltip>
          }
          prependBadges={
            <Badge
              color="violet"
              className="!leading-none inline-flex items-center gap-1"
            >
              <SparkleIcon size={9} weight="fill" />
              Suggested
            </Badge>
          }
        />
      ))}
    </Flex>
  );
}
