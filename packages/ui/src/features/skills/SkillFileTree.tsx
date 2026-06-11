import type { SkillFileEntry } from "@posthog/shared";
import {
  TreeDirectoryRow,
  TreeFileRow,
} from "@posthog/ui/primitives/TreeDirectoryRow";
import { Flex } from "@radix-ui/themes";
import { useMemo, useState } from "react";

interface TreeDir {
  name: string;
  path: string;
  dirs: TreeDir[];
  files: { name: string; path: string }[];
}

function buildTree(files: SkillFileEntry[]): TreeDir {
  const root: TreeDir = { name: "", path: "", dirs: [], files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join("/");
      let child = node.dirs.find((d) => d.path === dirPath);
      if (!child) {
        child = { name: parts[i] ?? "", path: dirPath, dirs: [], files: [] };
        node.dirs.push(child);
      }
      node = child;
    }
    node.files.push({ name: parts[parts.length - 1] ?? "", path: file.path });
  }
  return root;
}

interface SkillFileTreeProps {
  files: SkillFileEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function SkillFileTree({
  files,
  selectedPath,
  onSelect,
}: SkillFileTreeProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleDir = (dirPath: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  };

  const renderDir = (dir: TreeDir, depth: number): React.ReactNode => (
    <Flex direction="column" key={dir.path || "__root"}>
      {dir.dirs.map((child) => {
        const isExpanded = !collapsed.has(child.path);
        return (
          <Flex direction="column" key={child.path}>
            <TreeDirectoryRow
              name={child.name}
              depth={depth}
              isExpanded={isExpanded}
              onToggle={() => toggleDir(child.path)}
            />
            {isExpanded && renderDir(child, depth + 1)}
          </Flex>
        );
      })}
      {dir.files.map((file) => (
        <TreeFileRow
          key={file.path}
          fileName={file.name}
          depth={depth}
          isActive={selectedPath === file.path}
          title={file.path}
          onClick={() => onSelect(file.path)}
        />
      ))}
    </Flex>
  );

  return renderDir(tree, 0);
}
