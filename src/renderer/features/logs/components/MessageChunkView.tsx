import type { SessionNotification } from "@agentclientprotocol/sdk";
import { BaseLogEntry } from "@features/logs/components/BaseLogEntry";
import type { AgentNotification } from "@posthog/agent";
import {
  Blockquote,
  Box,
  Code,
  Em,
  Flex,
  Heading,
  Link,
  Strong,
  Text,
} from "@radix-ui/themes";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

interface MessageChunkViewProps {
  chunks: AgentNotification[];
  timestamp: number;
}

const components: Components = {
  h1: ({ children }) => (
    <Heading as="h1" size="5" mb="2">
      {children}
    </Heading>
  ),
  h2: ({ children }) => (
    <Heading as="h2" size="4" mb="2">
      {children}
    </Heading>
  ),
  h3: ({ children }) => (
    <Heading as="h3" size="3" mb="2">
      {children}
    </Heading>
  ),
  h4: ({ children }) => (
    <Heading as="h4" size="1" mb="1">
      {children}
    </Heading>
  ),
  h5: ({ children }) => (
    <Heading as="h5" size="1" mb="1">
      {children}
    </Heading>
  ),
  h6: ({ children }) => (
    <Heading as="h6" size="1" mb="1">
      {children}
    </Heading>
  ),
  p: ({ children }) => (
    <Text as="p" size="1" mb="2" style={{ lineHeight: "1.5" }}>
      {children}
    </Text>
  ),
  blockquote: ({ children }) => (
    <Blockquote size="1" mb="2">
      {children}
    </Blockquote>
  ),
  code: ({ children, className }) => {
    const isInline = !className?.includes("language-");
    if (isInline) {
      return (
        <Code size="1" variant="soft">
          {children}
        </Code>
      );
    }
    return (
      <Code
        size="1"
        variant="outline"
        className="block overflow-x-auto whitespace-pre p-2"
        style={{ display: "block", marginBottom: "0.5rem" }}
      >
        {children}
      </Code>
    );
  },
  pre: ({ children }) => <Box mb="2">{children}</Box>,
  em: ({ children }) => <Em>{children}</Em>,
  strong: ({ children }) => <Strong>{children}</Strong>,
  a: ({ href, children }) => (
    <Link href={href} target="_blank" rel="noopener noreferrer" size="1">
      {children}
    </Link>
  ),
  ul: ({ children }) => (
    <ul
      style={{
        marginBottom: "0.5rem",
        paddingLeft: "1.25rem",
        listStyleType: "disc",
      }}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol
      style={{
        marginBottom: "0.5rem",
        paddingLeft: "1.25rem",
        listStyleType: "decimal",
      }}
    >
      {children}
    </ol>
  ),
  li: ({ children }) => (
    <li
      style={{
        marginBottom: "0.25rem",
        lineHeight: "1.5",
        fontSize: "var(--font-size-2)",
      }}
    >
      {children}
    </li>
  ),
  hr: () => (
    <hr
      style={{
        marginTop: "0.75rem",
        marginBottom: "0.75rem",
        borderColor: "var(--gray-6)",
      }}
    />
  ),
};

export function MessageChunkView({ chunks, timestamp }: MessageChunkViewProps) {
  // Combine all text chunks into a single message
  const fullMessage = chunks
    .map((chunk) => {
      // Only process SessionNotifications
      if (!("sessionId" in chunk && "update" in chunk)) {
        return "";
      }
      const { update } = chunk as SessionNotification;
      if (
        "content" in update &&
        update.content &&
        typeof update.content === "object" &&
        "text" in update.content
      ) {
        return update.content.text;
      }
      return "";
    })
    .join("");

  if (!fullMessage.trim()) {
    return null;
  }

  return (
    <BaseLogEntry ts={timestamp}>
      <Flex direction="column" gap="2">
        <Box>
          <ReactMarkdown components={components}>{fullMessage}</ReactMarkdown>
        </Box>
      </Flex>
    </BaseLogEntry>
  );
}
