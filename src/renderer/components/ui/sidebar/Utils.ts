import type { TreeLine, TreeNode } from "@components/ui/sidebar/Types";

export function buildTreeLines(
  nodes: TreeNode[],
  prefix = "",
  parentId = "",
  expandedNodes: Set<string>,
  depth = 0,
): TreeLine[] {
  const lines: TreeLine[] = [];
  const isRoot = depth === 0;

  nodes.forEach((node, index) => {
    const isLastNode = index === nodes.length - 1;
    const connector = isRoot ? "" : isLastNode ? "└─ " : "├─ ";
    const nodeId = parentId ? `${parentId}.${index}` : `${index}`;
    const hasChildren = !!(node.children && node.children.length > 0);
    const showExpandIcon = hasChildren && depth > 0;

    lines.push({
      prefix,
      connector,
      label: node.label,
      nodeId,
      hasChildren: showExpandIcon,
      icon: node.icon,
      action: node.action,
      isActive: node.isActive,
      hoverAction: node.hoverAction,
      hoverIcon: node.hoverIcon,
      showHoverIconAlways: node.showHoverIconAlways,
      tooltip: node.tooltip,
    });

    if (
      hasChildren &&
      node.children &&
      (depth === 0 || expandedNodes.has(nodeId))
    ) {
      const childPrefix = isRoot ? "" : prefix + (isLastNode ? "   " : "│  ");
      lines.push(
        ...buildTreeLines(
          node.children,
          childPrefix,
          nodeId,
          expandedNodes,
          depth + 1,
        ),
      );
    }

    if (!isRoot && !hasChildren && node.forceSeparator && !isLastNode) {
      lines.push({
        prefix,
        connector: "│",
        label: "",
        nodeId: `${nodeId}-sep`,
        hasChildren: false,
      });
    }
  });

  return lines;
}

export function getAllNodeIds(
  nodes: TreeNode[],
  parentId = "",
  depth = 0,
): string[] {
  const nodeIds: string[] = [];

  nodes.forEach((node, index) => {
    const nodeId = parentId ? `${parentId}.${index}` : `${index}`;
    const hasChildren = !!(node.children && node.children.length > 0);

    if (hasChildren && depth > 0) {
      nodeIds.push(nodeId);
    }

    if (hasChildren && node.children) {
      nodeIds.push(...getAllNodeIds(node.children, nodeId, depth + 1));
    }
  });

  return nodeIds;
}
