/**
 * Parses YAML frontmatter from a SKILL.md file.
 * Extracts `name` and `description` fields.
 *
 * Handles:
 * - Simple values: `name: my-skill`
 * - Quoted strings: `description: 'Some text'` or `description: "Some text"`
 * - Multi-line folded: `description: >-\n  line1\n  line2`
 */
export function parseSkillFrontmatter(
  content: string,
): { name: string; description: string } | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const yaml = match[1];
  const name = extractYamlValue(yaml, "name");
  if (!name) return null;

  const description = extractYamlValue(yaml, "description") ?? "";
  return { name, description };
}

function extractYamlValue(yaml: string, key: string): string | null {
  const lines = yaml.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyPattern = new RegExp(`^${key}:\\s*(.*)$`);
    const match = line.match(keyPattern);
    if (!match) continue;

    const rawValue = match[1].trim();

    // Multi-line folded scalar (>- or >)
    if (rawValue === ">-" || rawValue === ">") {
      return collectIndentedLines(lines, i + 1).join(" ");
    }

    // Multi-line literal scalar (|- or |)
    if (rawValue === "|-" || rawValue === "|") {
      return collectIndentedLines(lines, i + 1).join("\n");
    }

    // Quoted string (single or double)
    if (
      (rawValue.startsWith("'") && rawValue.endsWith("'")) ||
      (rawValue.startsWith('"') && rawValue.endsWith('"'))
    ) {
      return rawValue.slice(1, -1);
    }

    // Plain scalar
    return rawValue;
  }

  return null;
}

function collectIndentedLines(lines: string[], startIndex: number): string[] {
  const result: string[] = [];
  let pendingBlanks = 0;
  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    // Blank lines only count if more indented content follows.
    if (/^\s*$/.test(line)) {
      pendingBlanks++;
      continue;
    }
    // Continuation lines must be indented
    if (line.match(/^\s+\S/)) {
      if (result.length > 0) {
        for (let b = 0; b < pendingBlanks; b++) result.push("");
      }
      pendingBlanks = 0;
      result.push(line.trim());
    } else {
      break;
    }
  }
  return result;
}
