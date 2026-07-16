import type { ChangedFile } from "@posthog/shared/domain-types";

export type ChangesGrouping = "directory" | "file-type";

export type FileTypeCategory =
  | "Implementation"
  | "Tests"
  | "Generated"
  | "Documentation"
  | "Configuration"
  | "Assets"
  | "Other";

const FILE_TYPE_CATEGORY_ORDER: FileTypeCategory[] = [
  "Implementation",
  "Tests",
  "Generated",
  "Documentation",
  "Configuration",
  "Assets",
  "Other",
];

const DOCUMENTATION_EXTENSIONS = new Set(["adoc", "md", "mdx", "rst", "txt"]);
const ASSET_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "mp3",
  "mp4",
  "ogg",
  "pdf",
  "svg",
  "webm",
  "webp",
  "woff",
  "woff2",
]);
const CONFIG_EXTENSIONS = new Set(["ini", "properties", "toml", "yaml", "yml"]);
const CONFIG_FILE_NAMES = new Set([
  "biome.json",
  "cargo.toml",
  "dockerfile",
  "gemfile",
  "go.mod",
  "package.json",
  "pnpm-workspace.yaml",
  "pyproject.toml",
  "requirements.txt",
  "tsconfig.json",
]);
const GENERATED_FILE_NAMES = new Set([
  "bun.lock",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
  "go.sum",
  "package-lock.json",
  "pnpm-lock.yaml",
  "poetry.lock",
  "uv.lock",
  "yarn.lock",
]);

export function classifyChangedFile(path: string): FileTypeCategory {
  const normalizedPath = path.toLowerCase();
  const segments = normalizedPath.split("/");
  const fileName = segments.at(-1) ?? normalizedPath;
  const extension = fileName.includes(".") ? fileName.split(".").at(-1) : "";

  if (
    segments.some((segment) =>
      ["__tests__", "e2e", "spec", "specs", "test", "tests"].includes(segment),
    ) ||
    /(?:^|\.)((?:e2e|integration|spec|test))\.[^.]+$/.test(fileName) ||
    /(?:^test_.+|.+_test)\.[^.]+$/.test(fileName) ||
    fileName.endsWith(".snap")
  ) {
    return "Tests";
  }

  if (
    GENERATED_FILE_NAMES.has(fileName) ||
    segments.some((segment) =>
      ["__generated__", "dist", "generated"].includes(segment),
    ) ||
    /(?:^|[._-])generated(?:[._-]|$)/.test(fileName) ||
    /(?:\.g|\.pb|\.designer)\.[^.]+$/.test(fileName) ||
    /_pb2(?:_grpc)?\.py$/.test(fileName)
  ) {
    return "Generated";
  }

  if (CONFIG_FILE_NAMES.has(fileName)) {
    return "Configuration";
  }

  if (
    segments.some((segment) =>
      ["doc", "docs", "documentation"].includes(segment),
    ) ||
    DOCUMENTATION_EXTENSIONS.has(extension ?? "") ||
    /^(changelog|contributing|license|readme)(\.|$)/.test(fileName)
  ) {
    return "Documentation";
  }

  if (
    segments.some((segment) =>
      [".github", ".husky", ".vscode", "config", "configs"].includes(segment),
    ) ||
    CONFIG_EXTENSIONS.has(extension ?? "") ||
    fileName.startsWith(".") ||
    /(?:^|\.)config\.[^.]+$/.test(fileName)
  ) {
    return "Configuration";
  }

  if (
    segments.some((segment) =>
      [
        "asset",
        "assets",
        "font",
        "fonts",
        "image",
        "images",
        "static",
      ].includes(segment),
    ) ||
    ASSET_EXTENSIONS.has(extension ?? "")
  ) {
    return "Assets";
  }

  if (extension) {
    return "Implementation";
  }

  return "Other";
}

export function groupChangesByFileType(
  files: ChangedFile[],
): { category: FileTypeCategory; files: ChangedFile[] }[] {
  const groups = new Map<FileTypeCategory, ChangedFile[]>();

  for (const file of files) {
    const category = classifyChangedFile(file.path);
    const categoryFiles = groups.get(category) ?? [];
    categoryFiles.push(file);
    groups.set(category, categoryFiles);
  }

  return FILE_TYPE_CATEGORY_ORDER.flatMap((category) => {
    const categoryFiles = groups.get(category);
    if (!categoryFiles) return [];
    return [
      {
        category,
        files: categoryFiles.sort((a, b) => a.path.localeCompare(b.path)),
      },
    ];
  });
}

export interface TreeNode {
  name: string;
  path: string;
  children: Map<string, TreeNode>;
  files: ChangedFile[];
}

export function buildChangesTree(files: ChangedFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map(), files: [] };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const part = parts[index];
      if (!node.children.has(part)) {
        node.children.set(part, {
          name: part,
          path: parts.slice(0, index + 1).join("/"),
          children: new Map(),
          files: [],
        });
      }
      const child = node.children.get(part);
      if (!child) break;
      node = child;
    }
    node.files.push(file);
  }
  return root;
}

export function compactTree(node: TreeNode): TreeNode {
  const compacted = new Map<string, TreeNode>();
  for (const [key, child] of node.children) {
    let current = child;
    let label = current.name;
    while (current.children.size === 1 && current.files.length === 0) {
      const [, only] = [...current.children.entries()][0];
      label = `${label}/${only.name}`;
      current = only;
    }
    const result = compactTree(current);
    result.name = label;
    compacted.set(key, result);
  }
  return { ...node, children: compacted };
}
