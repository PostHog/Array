import { BadgeRenderer } from "@features/logs/tools/BadgeRenderer";
import { ToolBadgeGroup, ToolMetadata } from "@features/logs/tools/ToolUI";
import type {
  BaseToolViewProps,
  WebSearchArgs,
  WebSearchResult,
  WebSearchResultItem,
} from "@features/logs/tools/types";
import { Box, Code } from "@radix-ui/themes";

type WebSearchToolViewProps = BaseToolViewProps<
  WebSearchArgs,
  string | WebSearchResult
>;

export function WebSearchToolView({ args, result }: WebSearchToolViewProps) {
  const { allowed_domains, blocked_domains } = args;

  // Parse result
  let results: WebSearchResultItem[] = [];
  if (result) {
    if (typeof result === "string") {
      try {
        const parsed = JSON.parse(result);
        results = parsed.results || [];
      } catch {
        // Result is just text
      }
    } else if (result && typeof result === "object" && "results" in result) {
      results = result.results || [];
    }
  }

  return (
    <Box>
      {(allowed_domains || blocked_domains) && (
        <ToolBadgeGroup>
          <BadgeRenderer
            badges={[
              {
                condition: allowed_domains,
                label: `Only: ${allowed_domains?.slice(0, 2).join(", ")}${
                  allowed_domains && allowed_domains.length > 2
                    ? ` +${allowed_domains.length - 2}`
                    : ""
                }`,
                color: "green",
              },
              {
                condition: blocked_domains,
                label: `Blocked: ${blocked_domains?.slice(0, 2).join(", ")}${
                  blocked_domains && blocked_domains.length > 2
                    ? ` +${blocked_domains.length - 2}`
                    : ""
                }`,
                color: "red",
              },
            ]}
          />
        </ToolBadgeGroup>
      )}
      {results.length > 0 && (
        <Box mt="2">
          <ToolMetadata>
            Found {results.length} result{results.length === 1 ? "" : "s"}:
          </ToolMetadata>
          <Box className="mt-2 space-y-2">
            {results.slice(0, 5).map((res, i) => (
              <Box
                key={res.url || `result-${i}`}
                className="rounded border border-gray-6 p-2"
              >
                {res.title && (
                  <Code size="2" variant="ghost" className="block">
                    {res.title}
                  </Code>
                )}
                {res.url && (
                  <Code
                    size="1"
                    color="gray"
                    variant="ghost"
                    className="mt-1 block"
                  >
                    {res.url}
                  </Code>
                )}
                {res.snippet && <ToolMetadata>{res.snippet}</ToolMetadata>}
              </Box>
            ))}
            {results.length > 5 && (
              <ToolMetadata>... and {results.length - 5} more</ToolMetadata>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
