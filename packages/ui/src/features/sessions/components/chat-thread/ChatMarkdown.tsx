import {
  Heading,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
} from "@posthog/quill";
import { HighlightedCode } from "@posthog/ui/primitives/HighlightedCode";
import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/**
 * The chat thread's own markdown renderer — intentionally separate from the app-wide
 * `MarkdownRenderer` (which carries PostHog deeplink handling, Radix Text wrappers, and other
 * product baggage). This one is a thin, generic react-markdown setup for chat bubble content:
 * GFM + sanitized HTML, minimal prose styling. Restyle the element map below per product.
 */
const components: Components = {
  p: ({ children }) => (
    <Text className="text-sm leading-[1.5]">{children}</Text>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => (
    <ul className="list-disc space-y-0.5 ps-4">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-0.5 ps-5">{children}</ol>
  ),
  li: ({ children }) => <li className="text-sm">{children}</li>,
  code: ({ className, children }) => {
    const match = /language-(\w+)/.exec(className ?? "");
    if (match) {
      // Fenced block with a language → Shiki-highlighted (theme-aware). The `pre` renderer
      // below provides the box; HighlightedCode renders the colored <code> inside it.
      return (
        <HighlightedCode
          code={String(children).replace(/\n$/, "")}
          language={match[1]}
          className="rounded-sm bg-muted/50 text-xs"
        />
      );
    }
    return (
      <code className="rounded rounded-sm border border-border bg-muted/50 px-1 font-mono text-xs">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-sm leading-[1.5]">
      {children}
    </pre>
  ),
  h1: ({ children }) => (
    <Heading size="xl" className="font-bold">
      {children}
    </Heading>
  ),
  h2: ({ children }) => (
    <Heading size="lg" className="font-bold">
      {children}
    </Heading>
  ),
  h3: ({ children }) => (
    <Heading size="base" className="font-bold">
      {children}
    </Heading>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-(--gray-6) border-s-2 ps-3 text-(--gray-11)">
      {children}
    </blockquote>
  ),
  hr: () => <Separator />,
  table: ({ children }) => (
    <Table size="sm" className="rounded-md border border-border">
      {children}
    </Table>
  ),
  thead: ({ children }) => <TableHeader>{children}</TableHeader>,
  th: ({ children }) => <TableHead>{children}</TableHead>,
  tbody: ({ children }) => <TableBody>{children}</TableBody>,
  tr: ({ children }) => <TableRow>{children}</TableRow>,
  td: ({ children }) => <TableCell>{children}</TableCell>,
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeSanitize];

export const ChatMarkdown = memo(function ChatMarkdown({
  content,
}: {
  content: string;
}) {
  return (
    <div className="flex flex-col gap-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
});
