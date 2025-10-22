import { Box, Code, DataList, Flex, Heading, Text } from "@radix-ui/themes";
import type { Task } from "@shared/types";
import { format, formatDistanceToNow } from "date-fns";
import { RichTextEditor } from "../RichTextEditor";

interface TaskPreviewProps {
  task: Task;
}

export function TaskPreview({ task }: TaskPreviewProps) {
  const createdAt = new Date(task.created_at);
  const createdAtFormatted = format(createdAt, "MMM d, yyyy h:mm a");
  const createdAtRelative = formatDistanceToNow(createdAt, { addSuffix: true });

  return (
    <Box p="4" overflowY="auto" height="100%" width="25%">
      <Flex direction="column" gap="4">
        {/* Header */}
        <Flex direction="row" gap="2" align="baseline">
          <Code size="3" color="gray" variant="ghost" style={{ flexShrink: 0 }}>
            {task.slug}
          </Code>
          <Heading size="5" style={{ flex: 1, minWidth: 0 }}>
            {task.title}
          </Heading>
        </Flex>

        {/* Description */}
        <Flex direction="column">
          <RichTextEditor
            value={task.description || ""}
            onChange={() => {}}
            readOnly
          />
        </Flex>

        {/* Metadata */}
        <DataList.Root size="1">
          <DataList.Item>
            <DataList.Label>Status</DataList.Label>
            <DataList.Value>
              <Text size="1">{task.status || "Backlog"}</Text>
            </DataList.Value>
          </DataList.Item>

          {task.repository_config && (
            <DataList.Item>
              <DataList.Label>Repository</DataList.Label>
              <DataList.Value>
                <Text size="1">
                  {task.repository_config.organization}/
                  {task.repository_config.repository}
                </Text>
              </DataList.Value>
            </DataList.Item>
          )}

          <DataList.Item>
            <DataList.Label>Created</DataList.Label>
            <DataList.Value>
              <Flex direction="column" gap="1">
                <Text size="1">{createdAtFormatted}</Text>
                <Text size="1" color="gray">
                  {createdAtRelative}
                </Text>
              </Flex>
            </DataList.Value>
          </DataList.Item>

          <DataList.Item>
            <DataList.Label>Source</DataList.Label>
            <DataList.Value>
              <Text size="1">{task.origin_product}</Text>
            </DataList.Value>
          </DataList.Item>
        </DataList.Root>
      </Flex>
    </Box>
  );
}
