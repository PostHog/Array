import { ToolCodeBlock, ToolMetadata } from "@features/logs/tools/ToolUI";
import { Box } from "@radix-ui/themes";

interface GlobToolViewProps {
  args: any;
  _unused?: {
    pattern: string;
    path?: string;
  };
  result?: string | string[];
}

export function GlobToolView({ args, result }: GlobToolViewProps) {
  const { path } = args;

  // Parse result if it's a string
  let files: string[] = [];
  if (result) {
    if (typeof result === "string") {
      try {
        files = JSON.parse(result);
      } catch {
        files = result.split("\n").filter(Boolean);
      }
    } else if (Array.isArray(result)) {
      files = result;
    }
  }

  return (
    <Box>
      {path && (
        <Box>
          <ToolMetadata>In: {path}</ToolMetadata>
        </Box>
      )}
      {files.length > 0 && (
        <Box mt={path ? "2" : "0"}>
          <ToolMetadata>
            Found {files.length} file{files.length === 1 ? "" : "s"}:
          </ToolMetadata>
          <ToolCodeBlock maxHeight="max-h-48">
            {`${files.slice(0, 50).join("\n")}${files.length > 50 ? `\n... and ${files.length - 50} more` : ""}`}
          </ToolCodeBlock>
        </Box>
      )}
    </Box>
  );
}
