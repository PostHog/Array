import {
  Blockquote,
  Box,
  Code,
  Em,
  Heading,
  Kbd,
  Link,
  Strong,
  Text,
} from "@radix-ui/themes";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";

interface MarkdownRendererProps {
  content: string;
}

const components: Components = {
  h1: ({ children }) => (
    <Heading as="h1" size="8" mb="3">
      {children}
    </Heading>
  ),
  h2: ({ children }) => (
    <Heading as="h2" size="7" mb="3">
      {children}
    </Heading>
  ),
  h3: ({ children }) => (
    <Heading as="h3" size="6" mb="2">
      {children}
    </Heading>
  ),
  h4: ({ children }) => (
    <Heading as="h4" size="5" mb="2">
      {children}
    </Heading>
  ),
  h5: ({ children }) => (
    <Heading as="h5" size="4" mb="2">
      {children}
    </Heading>
  ),
  h6: ({ children }) => (
    <Heading as="h6" size="3" mb="2">
      {children}
    </Heading>
  ),
  p: ({ children }) => (
    <Text as="p" size="2" mb="2" style={{ lineHeight: "1.6" }}>
      {children}
    </Text>
  ),
  blockquote: ({ children }) => (
    <Blockquote size="2" mb="3">
      {children}
    </Blockquote>
  ),
  code: ({ children, className }) => {
    const isInline = !className?.includes("language-");
    if (isInline) {
      return (
        <Code size="2" variant="soft">
          {children}
        </Code>
      );
    }
    return (
      <Code
        size="2"
        variant="outline"
        className="block overflow-x-auto whitespace-pre p-3"
        style={{ display: "block", marginBottom: "1rem" }}
      >
        {children}
      </Code>
    );
  },
  pre: ({ children }) => <Box mb="3">{children}</Box>,
  em: ({ children }) => <Em>{children}</Em>,
  strong: ({ children }) => <Strong>{children}</Strong>,
  a: ({ href, children }) => (
    <Link href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </Link>
  ),
  kbd: ({ children }) => <Kbd>{children}</Kbd>,
  ul: ({ children }) => (
    <ul
      style={{
        marginBottom: "1rem",
        paddingLeft: "1.5rem",
        listStyleType: "disc",
      }}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol
      style={{
        marginBottom: "1rem",
        paddingLeft: "1.5rem",
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
        lineHeight: "1.6",
        fontSize: "var(--font-size-2)",
      }}
    >
      {children}
    </li>
  ),
  hr: () => (
    <hr
      style={{
        marginTop: "1.5rem",
        marginBottom: "1.5rem",
        borderColor: "var(--gray-6)",
      }}
    />
  ),
};

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return <ReactMarkdown components={components}>{content}</ReactMarkdown>;
}
