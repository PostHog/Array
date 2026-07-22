import {
  buildChangeTree,
  type ChangeTreeNode,
  compactChangeTree,
} from "@posthog/core/git-interaction/changeTree";
import type { ChangedFile } from "@posthog/shared/domain-types";
import { TreeDirectoryRow } from "@posthog/ui/primitives/TreeDirectoryRow";
import { useCallback, useMemo, useState } from "react";

export type TreeNode = ChangeTreeNode;

export const buildChangesTree = buildChangeTree;
export const compactTree = compactChangeTree;

interface ChangesTreeNodeProps {
  node: TreeNode;
  depth: number;
  collapsedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  renderFile: (file: ChangedFile, depth: number) => React.ReactNode;
}

function ChangesTreeNode({
  node,
  depth,
  collapsedDirs,
  onToggleDir,
  renderFile,
}: ChangesTreeNodeProps) {
  const isCollapsed = collapsedDirs.has(node.path);
  const sortedDirs = useMemo(
    () =>
      [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [node.children],
  );
  const sortedFiles = useMemo(
    () =>
      [...node.files].sort((a, b) => {
        const aName = a.path.split("/").pop() || "";
        const bName = b.path.split("/").pop() || "";
        return aName.localeCompare(bName);
      }),
    [node.files],
  );

  return (
    <>
      {node.path && (
        <TreeDirectoryRow
          name={node.name}
          depth={depth}
          isExpanded={!isCollapsed}
          onToggle={() => onToggleDir(node.path)}
        />
      )}
      {!isCollapsed && (
        <>
          {sortedDirs.map((child) => (
            <ChangesTreeNode
              key={child.path}
              node={child}
              depth={node.path ? depth + 1 : depth}
              collapsedDirs={collapsedDirs}
              onToggleDir={onToggleDir}
              renderFile={renderFile}
            />
          ))}
          {sortedFiles.map((file) =>
            renderFile(file, node.path ? depth + 1 : depth),
          )}
        </>
      )}
    </>
  );
}

interface ChangesTreeViewProps {
  files: ChangedFile[];
  renderFile: (file: ChangedFile, depth: number) => React.ReactNode;
}

export function ChangesTreeView({ files, renderFile }: ChangesTreeViewProps) {
  const tree = useMemo(() => compactTree(buildChangesTree(files)), [files]);
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set());

  const handleToggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <ChangesTreeNode
      node={tree}
      depth={0}
      collapsedDirs={collapsedDirs}
      onToggleDir={handleToggleDir}
      renderFile={renderFile}
    />
  );
}
