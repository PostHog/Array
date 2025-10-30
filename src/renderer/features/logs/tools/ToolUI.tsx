import {
  CaretDown as CaretDownIcon,
  CaretRight as CaretRightIcon,
} from "@phosphor-icons/react";
import { Box, Code, ContextMenu } from "@radix-ui/themes";
import { formatTimestamp } from "@utils/time";
import { type ReactNode, useState } from "react";
import { IS_DEV } from "@/constants/environment";

interface ToolExecutionWrapperProps {
  toolName: string;
  statusBadge: ReactNode;
  statusColor: string;
  summary?: ReactNode;
  timestamp: number;
  durationMs?: number;
  isError?: boolean;
  children: ReactNode;
  forceExpanded?: boolean;
  onJumpToRaw?: (index: number) => void;
  index?: number;
}

export function ToolExecutionWrapper({
  toolName,
  statusBadge,
  statusColor,
  summary,
  timestamp,
  durationMs,
  isError = false,
  children,
  forceExpanded = false,
  onJumpToRaw,
  index,
}: ToolExecutionWrapperProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const expanded = forceExpanded || isExpanded;

  const durationSeconds =
    durationMs !== undefined ? (durationMs / 1000).toFixed(2) : undefined;

  const content = (
    <Box
      className={`overflow-hidden rounded-3 border ${
        isError ? "border-red-6 bg-red-1" : "border-gray-6"
      }`}
    >
      <Box
        className="flex cursor-pointer items-center gap-2 border-gray-6 border-b bg-gray-2 px-3 py-2 hover:bg-gray-3"
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ alignItems: "center" }}
      >
        <Box
          style={{
            display: "flex",
            alignItems: "center",
            color: "var(--gray-11)",
          }}
        >
          {expanded ? (
            <CaretDownIcon size={14} />
          ) : (
            <CaretRightIcon size={14} />
          )}
        </Box>
        <Box
          style={{
            display: "flex",
            alignItems: "center",
            color: `var(--${statusColor}-11)`,
          }}
        >
          {statusBadge}
        </Box>
        <Code
          size="1"
          color="gray"
          variant="ghost"
          style={{ display: "flex", alignItems: "center" }}
        >
          {formatTimestamp(timestamp)}
        </Code>
        <Code
          size="2"
          variant="ghost"
          style={{ display: "flex", alignItems: "center" }}
        >
          {toolName}
        </Code>
        {summary ? (
          <>
            <Box
              className="flex-1 truncate"
              style={{ display: "flex", alignItems: "center" }}
            >
              {summary}
            </Box>
            {durationSeconds !== undefined && (
              <Code
                size="1"
                color="gray"
                variant="ghost"
                style={{
                  display: "flex",
                  alignItems: "center",
                  marginLeft: "auto",
                }}
              >
                {durationSeconds}s
              </Code>
            )}
          </>
        ) : (
          durationSeconds !== undefined && (
            <Code
              size="1"
              color="gray"
              variant="ghost"
              style={{
                display: "flex",
                alignItems: "center",
                marginLeft: "auto",
              }}
            >
              {durationSeconds}s
            </Code>
          )
        )}
      </Box>
      {expanded && <Box className="p-3">{children}</Box>}
    </Box>
  );

  if (onJumpToRaw && index !== undefined) {
    return (
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <div style={{ cursor: "context-menu" }}>{content}</div>
        </ContextMenu.Trigger>
        <ContextMenu.Content>
          {IS_DEV && <ContextMenu.Label>{toolName}ToolView</ContextMenu.Label>}
          <ContextMenu.Item onClick={() => onJumpToRaw(index)}>
            Jump to raw source
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Root>
    );
  }

  return content;
}

interface ToolCodeBlockProps {
  children: string;
  maxHeight?: string;
  maxLength?: number;
  color?: "red" | "green";
  className?: string;
}

export function ToolCodeBlock({
  children,
  maxHeight = "max-h-64",
  maxLength,
  color,
  className = "",
}: ToolCodeBlockProps) {
  const truncated =
    maxLength && children.length > maxLength
      ? `${children.slice(0, maxLength)}…`
      : children;

  return (
    <Code
      size="2"
      variant="outline"
      color={color}
      className={`block ${maxHeight} overflow-x-auto whitespace-pre-wrap p-2 ${className}`}
    >
      {truncated}
    </Code>
  );
}

interface ToolMetadataProps {
  children: ReactNode;
}

export function ToolMetadata({ children }: ToolMetadataProps) {
  return (
    <Code size="1" color="gray" variant="ghost">
      {children}
    </Code>
  );
}

interface ToolResultMessageProps {
  success?: boolean;
  children: ReactNode;
}

export function ToolResultMessage({
  success = true,
  children,
}: ToolResultMessageProps) {
  return (
    <Code size="1" color={success ? "green" : "red"} variant="soft">
      {children}
    </Code>
  );
}

interface ToolBadgeGroupProps {
  children: ReactNode;
  className?: string;
}

export function ToolBadgeGroup({
  children,
  className = "",
}: ToolBadgeGroupProps) {
  return (
    <Box className={`flex items-center gap-2 ${className}`}>{children}</Box>
  );
}

interface ToolCommandBlockProps {
  command: string;
}

export function ToolCommandBlock({ command }: ToolCommandBlockProps) {
  return (
    <Code
      size="2"
      variant="outline"
      className="block overflow-x-auto whitespace-pre-wrap bg-gray-2 p-2"
    >
      $ {command}
    </Code>
  );
}

interface ToolSectionProps {
  label: string;
  children: ReactNode;
}

export function ToolSection({ label, children }: ToolSectionProps) {
  return (
    <Box>
      <ToolMetadata>{label}</ToolMetadata>
      {children}
    </Box>
  );
}
