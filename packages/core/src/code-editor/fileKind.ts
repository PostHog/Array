const MARKDOWN_EXTENSIONS = new Set(["md", "markdown"]);

export function isMarkdownFile(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase();
  return !!ext && MARKDOWN_EXTENSIONS.has(ext);
}
