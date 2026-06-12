/** Strips a leading YAML frontmatter block from a SKILL.md body. */
export function stripFrontmatter(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n/);
  return match ? content.slice(match[0].length).trimStart() : content;
}
