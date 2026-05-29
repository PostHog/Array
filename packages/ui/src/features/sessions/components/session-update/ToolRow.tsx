import type { Icon } from "@phosphor-icons/react";
import { Flex } from "@radix-ui/themes";
import type { ReactNode } from "react";
import { LoadingIcon, StatusIndicators, ToolTitle } from "./toolCallUtils";

interface ToolRowProps {
  icon: Icon;
  isLoading: boolean;
  isFailed?: boolean;
  wasCancelled?: boolean;
  children: ReactNode;
}

export function ToolRow({
  icon,
  isLoading,
  isFailed,
  wasCancelled,
  children,
}: ToolRowProps) {
  return (
    <Flex align="center" gap="2" className="min-w-0 py-0.5">
      <LoadingIcon icon={icon} isLoading={isLoading} />
      <ToolTitle>{children}</ToolTitle>
      <StatusIndicators isFailed={isFailed} wasCancelled={wasCancelled} />
    </Flex>
  );
}
