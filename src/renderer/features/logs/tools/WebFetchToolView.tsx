import { ToolCodeBlock, ToolMetadata } from "@features/logs/tools/ToolUI";
import type { BaseToolViewProps } from "@features/logs/tools/types";
import { Box, Code, Link } from "@radix-ui/themes";
import { getString } from "@utils/arg-extractors";

type WebFetchToolViewProps = BaseToolViewProps<
  Record<string, unknown>,
  unknown
>;

export function WebFetchToolView({ args, result }: WebFetchToolViewProps) {
  const url = getString(args, "url");
  const prompt = getString(args, "prompt");

  const resultText: string | undefined = result
    ? typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2)
    : undefined;

  return (
    <Box>
      <Link size="2" href={url} target="_blank" rel="noopener noreferrer">
        <Code variant="ghost">
          {url.length > 60 ? `${url.slice(0, 60)}…` : url}
        </Code>
      </Link>
      <Box mt="1">
        <ToolMetadata>Prompt: {prompt}</ToolMetadata>
      </Box>
      {resultText && (
        <Box mt="2">
          <ToolCodeBlock maxLength={3000}>{resultText}</ToolCodeBlock>
        </Box>
      )}
    </Box>
  );
}
