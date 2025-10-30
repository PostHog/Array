import { BaseLogEntry } from "@features/logs/components/BaseLogEntry";
import type { PostHogArtifactNotification } from "@posthog/agent";
import { Badge, Code, Flex, Text } from "@radix-ui/themes";

interface PostHogArtifactViewProps {
  notification: PostHogArtifactNotification;
}

export function PostHogArtifactView({
  notification,
}: PostHogArtifactViewProps) {
  const { type, _meta } = notification.params;
  const timestamp = notification.params.timestamp;

  // Handle research_questions artifact
  if (type === "research_questions" && Array.isArray(_meta.content)) {
    const questions = _meta.content;
    return (
      <BaseLogEntry ts={timestamp}>
        <Flex direction="column" gap="2">
          <Flex align="center" gap="2">
            <Badge color="blue" variant="soft">
              Artifact
            </Badge>
            <Text size="2" weight="bold">
              Research Questions Extracted
            </Text>
          </Flex>
          <Text size="2" color="gray">
            {questions.length} question{questions.length !== 1 ? "s" : ""} ready
            for review
          </Text>
        </Flex>
      </BaseLogEntry>
    );
  }

  // Generic artifact rendering
  return (
    <BaseLogEntry ts={timestamp}>
      <Flex direction="column" gap="2">
        <Flex align="center" gap="2">
          <Badge color="blue" variant="soft">
            Artifact
          </Badge>
          <Text size="2" weight="bold">
            {type}
          </Text>
        </Flex>
        {_meta.content && (
          <Code size="1" variant="ghost">
            {JSON.stringify(_meta.content, null, 2)}
          </Code>
        )}
      </Flex>
    </BaseLogEntry>
  );
}
