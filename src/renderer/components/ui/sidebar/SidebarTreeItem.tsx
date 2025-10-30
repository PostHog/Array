import type { TreeLine } from "@components/ui/sidebar/Types";
import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react";
import { Tooltip } from "@radix-ui/themes";

interface SidebarTreeItemProps {
  line: TreeLine;
  index: number;
  isHovered: boolean;
  expandedNodes: Set<string>;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onToggle: (nodeId: string) => void;
}

export function SidebarTreeItem({
  line,
  index,
  isHovered,
  expandedNodes,
  onMouseEnter,
  onMouseLeave,
  onToggle,
}: SidebarTreeItemProps) {
  const isInteractive = line.label && (line.hasChildren || line.action);

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Tree navigation is handled by parent component
    // biome-ignore lint/a11y/noStaticElementInteractions: Tree item click handler provides semantic interaction
    <div
      key={index}
      style={{
        whiteSpace: "pre",
        cursor: isInteractive ? "pointer" : "default",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
      className={`${isInteractive ? "tree-item-hover" : ""} ${line.isActive ? "tree-item-active" : ""}`}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={() => {
        if (line.label) {
          if (line.hasChildren) {
            onToggle(line.nodeId);
          } else if (line.action) {
            line.action();
          }
        }
      }}
    >
      <span style={{ display: "flex", alignItems: "center", flex: 1 }}>
        <span>
          {line.prefix}
          {line.connector}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          {line.icon && (
            <span style={{ display: "flex", alignItems: "center" }}>
              {line.icon}
            </span>
          )}
          {line.tooltip ? (
            <Tooltip content={line.tooltip}>
              <span>{line.label}</span>
            </Tooltip>
          ) : (
            <span>{line.label}</span>
          )}
          {line.hasChildren && (
            <span style={{ display: "flex", alignItems: "center" }}>
              {expandedNodes.has(line.nodeId) ? (
                <CaretDownIcon size={12} weight="fill" />
              ) : (
                <CaretRightIcon size={12} weight="fill" />
              )}
            </span>
          )}
        </span>
      </span>
      {(isHovered || line.showHoverIconAlways) &&
        line.hoverAction &&
        line.hoverIcon && (
          // biome-ignore lint/a11y/useKeyWithClickEvents: Action button is secondary UI, primary navigation via parent
          // biome-ignore lint/a11y/noStaticElementInteractions: Click handler provides semantic button interaction
          <span
            style={{
              display: "flex",
              alignItems: "center",
              cursor: "pointer",
              marginLeft: "auto",
              padding: "2px",
              borderRadius: "2px",
              transition: "background-color 0.1s",
            }}
            className={
              line.label === "Recordings" ||
              line.label?.startsWith("Recordings")
                ? "tree-item-action-hover-red"
                : "tree-item-action-hover"
            }
            onClick={(e) => {
              e.stopPropagation();
              line.hoverAction?.();
            }}
          >
            {line.hoverIcon}
          </span>
        )}
    </div>
  );
}
