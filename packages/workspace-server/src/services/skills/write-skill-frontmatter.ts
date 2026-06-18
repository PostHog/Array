/**
 * Serializes a SKILL.md file from frontmatter metadata plus a markdown body.
 *
 * The output must round-trip through `parseSkillFrontmatter` and also be
 * valid YAML for the agents that consume these files, so scalars fall back
 * from plain → double-quoted → literal block as they get more hostile.
 */
export function serializeSkillMarkdown(
  meta: { name: string; description: string },
  body: string,
): string {
  const frontmatter = [
    "---",
    `name: ${serializeScalar(meta.name)}`,
    `description: ${serializeScalar(meta.description)}`,
    "---",
  ].join("\n");

  const trimmedBody = body.replace(/^\n+/, "");
  return `${frontmatter}\n\n${trimmedBody.trimEnd()}\n`;
}

const PLAIN_SAFE = /^[A-Za-z0-9][A-Za-z0-9 _.,;()/-]*$/;

function serializeScalar(value: string): string {
  if (value === "") return '""';
  if (!value.includes("\n")) {
    if (PLAIN_SAFE.test(value) && !value.endsWith(" ")) return value;
    if (!value.includes('"') && !value.includes("\\")) return `"${value}"`;
  }
  // Literal block: survives quotes, backslashes, and newlines.
  const lines = value
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : ""));
  return `|-\n${lines.join("\n")}`;
}
