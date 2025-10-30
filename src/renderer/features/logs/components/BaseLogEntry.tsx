import { Box, Code } from "@radix-ui/themes";
import { formatTimestamp } from "@utils/time";
import type { ReactNode } from "react";

interface BaseLogEntryProps {
  ts: number;
  children: ReactNode;
  mb?: string;
}

export function BaseLogEntry({ ts, children, mb = "2" }: BaseLogEntryProps) {
  return (
    <Box
      mb={mb}
      className="hover:bg-gray-3"
      style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}
    >
      <Code size="1" color="gray" variant="ghost">
        {formatTimestamp(ts)}
      </Code>
      {children}
    </Box>
  );
}
