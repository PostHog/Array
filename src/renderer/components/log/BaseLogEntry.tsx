import { Box, Code } from "@radix-ui/themes";
import type { ReactNode } from "react";

interface BaseLogEntryProps {
  ts: number;
  children: ReactNode;
  mb?: string;
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function BaseLogEntry({ ts, children, mb = "2" }: BaseLogEntryProps) {
  return (
    <Box
      mb={mb}
      className="hover:bg-gray-3"
      style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}
    >
      <Code size="2" color="gray" variant="ghost">
        {formatTime(ts)}
      </Code>
      {children}
    </Box>
  );
}
