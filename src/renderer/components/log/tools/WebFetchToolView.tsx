import { Box, Code, Link } from "@radix-ui/themes";
import { ToolCodeBlock, ToolMetadata } from "./ToolUI";

interface WebFetchToolViewProps {
  args: any;
  _unused?: {
    url: string;
    prompt: string;
  };
  result?: any;
}

export function WebFetchToolView({ args, result }: WebFetchToolViewProps) {
  const { url, prompt } = args;

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
      {result && (
        <Box mt="2">
          <ToolCodeBlock maxLength={3000}>
            {typeof result === "string"
              ? result
              : JSON.stringify(result, null, 2)}
          </ToolCodeBlock>
        </Box>
      )}
    </Box>
  );
}
