import { Check, Copy } from "@phosphor-icons/react";
import {
  buildResolvedLabel,
  fetchPostHogResourceTitle,
} from "@posthog/core/message-editor/posthogChip";
import {
  type ParsedPostHogUrl,
  parsePostHogUrl,
} from "@posthog/core/message-editor/posthogUrl";
import { useHostTRPC } from "@posthog/host-router/react";
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
import { unescapeXmlAttr } from "@posthog/shared";
import { GithubRefChip } from "@posthog/ui/features/editor/components/GithubRefChip";
import { PostHogRefChip } from "@posthog/ui/features/editor/components/PostHogRefChip";
import {
  parseOpenFence,
  splitMarkdownBlocks,
} from "@posthog/ui/features/editor/components/splitMarkdownBlocks";
import {
  type ParsedGithubIssueUrl,
  parseGithubIssueUrl,
} from "@posthog/ui/features/message-editor/githubIssueUrl";
import {
  BareFileLink,
  hasDirectoryPath,
  InlineFileLink,
  looksLikeBareFilename,
} from "@posthog/ui/features/sessions/components/session-update/fileLinkChips";
import { useAuthenticatedQuery } from "@posthog/ui/hooks/useAuthenticatedQuery";
import { HighlightedCode } from "@posthog/ui/primitives/HighlightedCode";
import { useCopy } from "@posthog/ui/primitives/useCopy";
import { IconButton } from "@radix-ui/themes";
import { useQuery } from "@tanstack/react-query";
import { memo, type ReactNode, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

const POSTHOG_CHIP_TAG_REGEX =
  /<(feature_flag|experiment|insight|dashboard|recording|error_tracking|survey|notebook|cohort|action|early_access_feature|person|group)\s+id="([^"]+)"(?:\s+label="([^"]*)")?\s*\/>/g;

/** Converts persisted PostHog XML chip tags (see `content.ts`) into markdown links so the `a`
 * component below can render them as {@link SmartPostHogRefChip}. */
function preprocessChipTags(content: string): string {
  return content.replace(POSTHOG_CHIP_TAG_REGEX, (_, _type, id, label) => {
    const url = unescapeXmlAttr(id);
    const text = label ? unescapeXmlAttr(label) : url;
    return `[${text}](${url})`;
  });
}

/** Mirrors `MarkdownRenderer`'s `SmartGithubRefChip` — resolves the issue/PR title via tRPC. */
function SmartGithubRefChip({ parsed }: { parsed: ParsedGithubIssueUrl }) {
  const trpc = useHostTRPC();
  const input = {
    owner: parsed.owner,
    repo: parsed.repo,
    number: parsed.number,
  };
  const options =
    parsed.kind === "pr"
      ? trpc.git.getGithubPullRequest.queryOptions(input)
      : trpc.git.getGithubIssue.queryOptions(input);
  const { data } = useQuery({ ...options, staleTime: 60_000 });

  const label = data?.title
    ? `#${parsed.number} - ${data.title}`
    : `${parsed.owner}/${parsed.repo}#${parsed.number}`;

  return (
    <GithubRefChip href={parsed.normalizedUrl} kind={parsed.kind}>
      {label}
    </GithubRefChip>
  );
}

/** Mirrors `MarkdownRenderer`'s `SmartPostHogRefChip` — resolves the resource title via the
 * authenticated PostHog API client. */
function SmartPostHogRefChip({ parsed }: { parsed: ParsedPostHogUrl }) {
  const { data: title } = useAuthenticatedQuery(
    ["posthog-resource", parsed.normalizedUrl],
    (client) => fetchPostHogResourceTitle(client, parsed),
    { staleTime: 60_000 },
  );

  const label = buildResolvedLabel(parsed, title ?? null);

  return (
    <PostHogRefChip
      href={parsed.normalizedUrl}
      resourceType={parsed.resourceType}
    >
      {label}
    </PostHogRefChip>
  );
}

function ChatCodeBlock({
  code,
  children,
}: {
  code: string;
  children: ReactNode;
}) {
  const { copied, copy } = useCopy();

  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg border border-border bg-muted/50 p-3 pr-10 text-sm leading-[1.5]">
        {children}
      </pre>
      <IconButton
        size="1"
        variant="ghost"
        color={copied ? "green" : "gray"}
        onClick={() => copy(code)}
        className="absolute top-1 right-1 cursor-pointer opacity-0 transition-opacity group-hover:opacity-100"
        aria-label="Copy code"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </IconButton>
    </div>
  );
}

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
  a: ({ children, href }) => {
    const githubRef = href ? parseGithubIssueUrl(href) : null;
    if (githubRef) {
      const isAutoLink = typeof children === "string" && children === href;
      if (isAutoLink) {
        return <SmartGithubRefChip parsed={githubRef} />;
      }
      return (
        <GithubRefChip href={githubRef.normalizedUrl} kind={githubRef.kind}>
          {children}
        </GithubRefChip>
      );
    }
    const posthogRef = href ? parsePostHogUrl(href) : null;
    if (posthogRef) {
      const isAutoLink = typeof children === "string" && children === href;
      if (isAutoLink) {
        return <SmartPostHogRefChip parsed={posthogRef} />;
      }
      return (
        <PostHogRefChip
          href={posthogRef.normalizedUrl}
          resourceType={posthogRef.resourceType}
        >
          {children}
        </PostHogRefChip>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-primary underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
  ul: ({ children }) => (
    <ul className="list-disc space-y-0.5 ps-4">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal space-y-0.5 ps-5">{children}</ol>
  ),
  li: ({ children }) => <li className="text-sm">{children}</li>,
  code: ({ className, children }) => {
    const text = String(children).replace(/\n$/, "");
    const match = /language-(\w+)/.exec(className ?? "");
    // Fenced blocks (carry a language, or span multiple lines) render as a boxed, copyable
    // block; short inline spans stay inline. `pre` below is a passthrough so the box lives here,
    // where the raw code string is in hand.
    if (match || text.includes("\n")) {
      return (
        <ChatCodeBlock code={text}>
          {match ? (
            <HighlightedCode
              code={text}
              language={match[1]}
              className="text-xs"
            />
          ) : (
            <code className="font-mono text-xs">{text}</code>
          )}
        </ChatCodeBlock>
      );
    }
    const fallback = (
      <code className="rounded rounded-sm border border-border bg-muted/50 px-1 font-mono text-xs">
        {children}
      </code>
    );
    if (hasDirectoryPath(text)) {
      return <InlineFileLink text={text} />;
    }
    if (looksLikeBareFilename(text)) {
      return <BareFileLink text={text} fallback={fallback} />;
    }
    return fallback;
  },
  pre: ({ children }) => <>{children}</>,
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
  const processedContent = useMemo(
    () => preprocessChipTags(content),
    [content],
  );
  return (
    <div className="flex flex-col gap-3 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <Markdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {processedContent}
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
              <ChatCodeBlock code={openFence.code}>
                <code className="font-mono text-xs">{openFence.code}</code>
              </ChatCodeBlock>
            </div>
          );
        }
        return <ChatMarkdown key={key} content={block} />;
      })}
    </div>
  );
});
