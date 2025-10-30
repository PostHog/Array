import { BadgeRenderer } from "@features/logs/tools/BadgeRenderer";
import {
  ToolCodeBlock,
  ToolResultMessage,
  ToolSection,
} from "@features/logs/tools/ToolUI";
import type { BaseToolViewProps } from "@features/logs/tools/types";
import { Box } from "@radix-ui/themes";
import { getBoolean, getString } from "@utils/arg-extractors";

type EditToolViewProps = BaseToolViewProps<Record<string, unknown>, unknown>;

export function EditToolView({ args, result }: EditToolViewProps) {
  const old_string = getString(args, "old_string");
  const new_string = getString(args, "new_string");
  const replace_all = getBoolean(args, "replace_all");

  // Prefer diff from result (ACP format) if available
  let oldText: string | undefined;
  let newText: string | undefined;

  if (
    result &&
    typeof result === "object" &&
    "type" in result &&
    result.type === "diff"
  ) {
    const diffResult = result as Record<string, unknown>;
    oldText =
      typeof diffResult.oldText === "string" ? diffResult.oldText : undefined;
    newText =
      typeof diffResult.newText === "string" ? diffResult.newText : undefined;
  } else {
    // Fallback to args
    oldText = old_string;
    newText = new_string;
  }

  // Show success message only if result is a string (legacy) or status indicates completion
  const showSuccess = !!(result && typeof result === "string");

  return (
    <Box>
      {replace_all && (
        <Box mb="2">
          <BadgeRenderer
            badges={[
              { condition: replace_all, label: "replace all", color: "blue" },
            ]}
          />
        </Box>
      )}
      <Box className="space-y-2">
        <ToolSection label="Old:">
          <ToolCodeBlock color="red" maxHeight="max-h-32" maxLength={500}>
            {oldText}
          </ToolCodeBlock>
        </ToolSection>
        <ToolSection label="New:">
          <ToolCodeBlock color="green" maxHeight="max-h-32" maxLength={500}>
            {newText}
          </ToolCodeBlock>
        </ToolSection>
      </Box>
      {showSuccess && (
        <Box mt="2">
          <ToolResultMessage>Edit applied successfully</ToolResultMessage>
        </Box>
      )}
    </Box>
  );
}
