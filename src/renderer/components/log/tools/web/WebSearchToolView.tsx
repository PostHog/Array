import { Badge, Box, Code } from "@radix-ui/themes";
import {
  ToolBadgeGroup,
  ToolMetadata,
} from "@renderer/components/log/tools/ToolUI";

interface WebSearchToolViewProps {
  args: any;
  _unused?: {
    query: string;
    allowed_domains?: string[];
    blocked_domains?: string[];
  };
  result?:
    | string
    | { results?: Array<{ title?: string; url?: string; snippet?: string }> };
}

export function WebSearchToolView({ args, result }: WebSearchToolViewProps) {
  const { allowed_domains, blocked_domains } = args;

  // Parse result
  let results: Array<{ title?: string; url?: string; snippet?: string }> = [];
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
          {allowed_domains && (
            <Badge size="1" color="green">
              Only: {allowed_domains.slice(0, 2).join(", ")}
              {allowed_domains.length > 2 && ` +${allowed_domains.length - 2}`}
            </Badge>
          )}
          {blocked_domains && (
            <Badge size="1" color="red">
              Blocked: {blocked_domains.slice(0, 2).join(", ")}
              {blocked_domains.length > 2 && ` +${blocked_domains.length - 2}`}
            </Badge>
          )}
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
