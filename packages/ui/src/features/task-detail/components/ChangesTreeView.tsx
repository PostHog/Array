import type { ChangedFile } from "@posthog/shared/domain-types";
import { TreeDirectoryRow } from "@posthog/ui/primitives/TreeDirectoryRow";
import { useCallback, useMemo, useState } from "react";
import {
  buildChangesTree,
  type ChangesGrouping,
  compactTree,
  groupChangesByFileType,
  type TreeNode,
} from "./changesTree";

interface ChangesTreeNodeProps {
  node: TreeNode;
  depth: number;
  collapsedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  renderFile: (
    file: ChangedFile,
    depth: number,
    showFullPath: boolean,
  ) => React.ReactNode;
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
            renderFile(file, node.path ? depth + 1 : depth, false),
          )}
        </>
      )}
    </>
  );
}

interface ChangesTreeViewProps {
  files: ChangedFile[];
  grouping: ChangesGrouping;
  renderFile: (
    file: ChangedFile,
    depth: number,
    showFullPath: boolean,
  ) => React.ReactNode;
}

export function ChangesTreeView({
  files,
  grouping,
  renderFile,
}: ChangesTreeViewProps) {
  const tree = useMemo(() => compactTree(buildChangesTree(files)), [files]);
  const fileTypeGroups = useMemo(() => groupChangesByFileType(files), [files]);
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

  if (grouping === "file-type") {
    return fileTypeGroups.map(({ category, files: categoryFiles }) => {
      const categoryPath = `file-type:${category}`;
      const isCollapsed = collapsedDirs.has(categoryPath);

      return (
        <div key={category}>
          <TreeDirectoryRow
            name={`${category} (${categoryFiles.length})`}
            depth={0}
            isExpanded={!isCollapsed}
            onToggle={() => handleToggleDir(categoryPath)}
          />
          {!isCollapsed &&
            categoryFiles.map((file) => renderFile(file, 1, true))}
        </div>
      );
    });
  }

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
