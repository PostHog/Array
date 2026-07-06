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
import {
  parseOpenFence,
  splitMarkdownBlocks,
} from "@posthog/ui/features/editor/components/splitMarkdownBlocks";
import { HighlightedCode } from "@posthog/ui/primitives/HighlightedCode";
import { memo, useMemo } from "react";
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

/**
 * Streaming variant of {@link ChatMarkdown}: splits the message into top-level blocks so completed
 * blocks keep a stable string and their memoized parse is reused — each streamed frame re-parses
 * only the growing tail block, O(last block) instead of O(message).
 *
 * While the tail sits inside an unterminated code fence it renders as plain monospace in the same
 * `pre` box the finished block will use — no per-frame Shiki highlight, no layout shift when the
 * fence closes. Completed messages should render through {@link ChatMarkdown} directly for a
 * single, fully-correct parse.
 */
export const ChatStreamingMarkdown = memo(function ChatStreamingMarkdown({
  content,
}: {
  content: string;
}) {
  const blocks = useMemo(() => splitMarkdownBlocks(content), [content]);
  const lastIndex = blocks.length - 1;

  return (
    <div className="flex flex-col gap-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      {blocks.map((block, index) => {
        const key = `b${index}`;
        const openFence = index === lastIndex ? parseOpenFence(block) : null;
        if (openFence) {
          return (
            <div key={key} className="flex flex-col gap-3">
              {openFence.before.trim() ? (
                <ChatMarkdown content={openFence.before} />
              ) : null}
              <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 text-sm leading-[1.5]">
                <code className="font-mono text-xs">{openFence.code}</code>
              </pre>
            </div>
          );
        }
        return <ChatMarkdown key={key} content={block} />;
      })}
    </div>
  );
});
