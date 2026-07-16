import { Plugs } from "@phosphor-icons/react";
import type { LocalMcpCloudClassification } from "@posthog/core/local-mcp/localMcpImport";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  MenuLabel,
} from "@posthog/quill";

const AVAILABILITY_LABELS: Record<
  LocalMcpCloudClassification["availability"],
  string
> = {
  importable: "Available in cloud",
  requires_desktop: "Requires your machine",
  unsupported: "Not available in cloud",
};

interface LocalMcpServersButtonProps {
  servers: LocalMcpCloudClassification[];
  disabled?: boolean;
}

/**
 * Shows which of the user's local MCP servers will be available inside the
 * cloud sandbox for this run, and why the rest won't.
 */
export function LocalMcpServersButton({
  servers,
  disabled,
}: LocalMcpServersButtonProps) {
  if (servers.length === 0) return null;
  const importable = servers.filter((s) => s.availability === "importable");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            aria-label="Local MCP servers in cloud"
            disabled={disabled}
          >
            <Plugs size={14} weight="regular" className="shrink-0" />
            <span className="font-medium tabular-nums">
              {importable.length}/{servers.length}
            </span>
          </Button>
        }
      />
      <DropdownMenuContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="min-w-[280px]"
      >
        <MenuLabel>Your MCP servers in this cloud run</MenuLabel>
        {servers.map((server) => (
          <div
            key={server.name}
            className="flex items-center gap-3 px-2 py-1.5 text-sm"
          >
            <span className="min-w-0 flex-1 truncate" title={server.name}>
              {server.name}
            </span>
            <span className="shrink-0 text-muted-foreground text-xs">
              {AVAILABILITY_LABELS[server.availability]}
            </span>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
