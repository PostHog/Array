import type { JSONContent } from "@tiptap/react";

/**
 * Convert Tiptap JSON to markdown string with XML file tags
 */
export function tiptapToMarkdown(json: JSONContent): string {
  if (!json || !json.content) return "";

  const lines: string[] = [];

  for (const node of json.content) {
    lines.push(nodeToMarkdown(node));
  }

  return lines.join("\n").trim();
}

function nodeToMarkdown(node: JSONContent): string {
  switch (node.type) {
    case "paragraph":
      return paragraphToMarkdown(node);
    case "text":
      return formatTextNode(node);
    case "mention": {
      // Check if this is a file or URL mention based on attributes
      const mentionId = node.attrs?.id || "";
      const mentionType = node.attrs?.type;
      const urlId = node.attrs?.urlId;

      if (mentionType && mentionType !== "file") {
        // PostHog resource mentions use specific tag names
        switch (mentionType) {
          case "error":
            return `<error id="${urlId || mentionId}" />`;
          case "experiment":
            return `<experiment id="${urlId || mentionId}" />`;
          case "insight":
            return `<insight id="${urlId || mentionId}" />`;
          case "feature_flag":
            return `<feature_flag id="${urlId || mentionId}" />`;
          default:
            // Generic URLs use href
            return `<url href="${mentionId}" />`;
        }
      } else {
        // File mention - convert to XML tag
        return `<file path="${mentionId}" />`;
      }
    }
    case "hardBreak":
      return "\n";
    case "heading": {
      const level = node.attrs?.level || 1;
      const headingText = node.content
        ? node.content.map(nodeToMarkdown).join("")
        : "";
      return `${"#".repeat(level)} ${headingText}`;
    }
    case "bulletList":
      return listToMarkdown(node, "bullet");
    case "orderedList":
      return listToMarkdown(node, "ordered");
    case "listItem":
      return listItemToMarkdown(node);
    case "blockquote": {
      const quoteContent = node.content
        ? node.content.map(nodeToMarkdown).join("\n")
        : "";
      return `> ${quoteContent.replace(/\n/g, "\n> ")}`;
    }
    case "codeBlock": {
      const language = node.attrs?.language || "";
      const codeContent = node.content
        ? node.content.map(nodeToMarkdown).join("")
        : "";
      return `\`\`\`${language}\n${codeContent}\n\`\`\``;
    }
    case "horizontalRule":
      return "---";
    default:
      // Handle other node types recursively
      if (node.content) {
        return node.content.map(nodeToMarkdown).join("");
      }
      return "";
  }
}

function formatTextNode(node: JSONContent): string {
  let text = node.text || "";

  if (node.marks) {
    for (const mark of node.marks) {
      switch (mark.type) {
        case "bold":
          text = `**${text}**`;
          break;
        case "italic":
          text = `*${text}*`;
          break;
        case "underline":
          text = `<u>${text}</u>`;
          break;
        case "strike":
          text = `~~${text}~~`;
          break;
        case "code":
          text = `\`${text}\``;
          break;
        case "link": {
          const href = mark.attrs?.href || "";
          text = `[${text}](${href})`;
          break;
        }
      }
    }
  }

  return text;
}

function listToMarkdown(node: JSONContent, type: "bullet" | "ordered"): string {
  if (!node.content) return "";

  return node.content
    .map((item, index) => {
      const marker = type === "bullet" ? "- " : `${index + 1}. `;
      return marker + nodeToMarkdown(item).replace(/^\n+|\n+$/g, "");
    })
    .join("\n");
}

function listItemToMarkdown(node: JSONContent): string {
  if (!node.content) return "";
  return node.content.map(nodeToMarkdown).join("");
}

function paragraphToMarkdown(node: JSONContent): string {
  if (!node.content) return "";

  const content = node.content.map(nodeToMarkdown).join("");
  return content;
}

/**
 * Parse markdown string with XML file tags back to Tiptap JSON
 */
export function markdownToTiptap(markdown: string): JSONContent {
  if (!markdown) {
    return {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [],
        },
      ],
    };
  }

  // Simple markdown parser - this is a basic implementation
  // For production, consider using a proper markdown parser like markdown-it
  const content: JSONContent[] = [];
  const lines = markdown.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (line === "") {
      // Skip empty lines but add paragraph break if needed
      if (
        content.length > 0 &&
        content[content.length - 1].type !== "paragraph"
      ) {
        content.push({ type: "paragraph", content: [] });
      }
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      content.push({
        type: "heading",
        attrs: { level: headingMatch[1].length },
        content: parseInlineContent(headingMatch[2]),
      });
      i++;
      continue;
    }

    // Blockquotes
    if (line.startsWith("> ")) {
      const quoteLines = [];
      while (
        i < lines.length &&
        (lines[i].startsWith("> ") || lines[i].trim() === "")
      ) {
        if (lines[i].startsWith("> ")) {
          quoteLines.push(lines[i].substring(2));
        } else if (lines[i].trim() === "") {
          quoteLines.push("");
        }
        i++;
      }

      const quoteContent = parseBlockContent(quoteLines.join("\n"));
      content.push({
        type: "blockquote",
        content: quoteContent,
      });
      continue;
    }

    // Code blocks
    if (line.startsWith("```")) {
      const language = line.substring(3).trim();
      const codeLines = [];
      i++; // Skip opening ```

      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // Skip closing ```

      content.push({
        type: "codeBlock",
        attrs: language ? { language } : {},
        content: [
          {
            type: "text",
            text: codeLines.join("\n"),
          },
        ],
      });
      continue;
    }

    // Lists
    const bulletMatch = line.match(/^[-*+]\s+(.+)$/);
    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);

    if (bulletMatch || orderedMatch) {
      const isBullet = !!bulletMatch;
      const listItems = [];

      while (i < lines.length) {
        const currentLine = lines[i].trim();
        const currentBulletMatch = currentLine.match(/^[-*+]\s+(.+)$/);
        const currentOrderedMatch = currentLine.match(/^\d+\.\s+(.+)$/);

        if (
          (isBullet && currentBulletMatch) ||
          (!isBullet && currentOrderedMatch)
        ) {
          const itemText =
            (currentBulletMatch || currentOrderedMatch)?.[1] || "";
          listItems.push({
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: parseInlineContent(itemText),
              },
            ],
          });
          i++;
        } else {
          break;
        }
      }

      content.push({
        type: isBullet ? "bulletList" : "orderedList",
        content: listItems,
      });
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      content.push({ type: "horizontalRule" });
      i++;
      continue;
    }

    // Regular paragraph
    const paragraphContent = parseInlineContent(line);
    content.push({
      type: "paragraph",
      content: paragraphContent,
    });
    i++;
  }

  return {
    type: "doc",
    content:
      content.length > 0 ? content : [{ type: "paragraph", content: [] }],
  };
}

function parseBlockContent(text: string): JSONContent[] {
  // For simplicity, treat block content as paragraphs
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return lines.map((line) => ({
    type: "paragraph",
    content: parseInlineContent(line),
  }));
}

function parseInlineContent(text: string): JSONContent[] {
  const nodes: JSONContent[] = [];

  // Parse inline formatting and file mentions
  // This is a simplified parser - for production use a proper markdown parser

  let i = 0;
  let currentText = "";

  const flushText = () => {
    if (currentText) {
      nodes.push({ type: "text", text: currentText });
      currentText = "";
    }
  };

  while (i < text.length) {
    // PostHog resource mentions: <error id="..." />, <experiment id="..." />, etc.
    const resourceMatch = text
      .substring(i)
      .match(/^<(error|experiment|insight|feature_flag)\s+id="([^"]+)"\s*\/>/);
    if (resourceMatch) {
      flushText();
      const [fullMatch, type, id] = resourceMatch;
      nodes.push({
        type: "mention",
        attrs: {
          id: "", // We'll store the URL in the id later if needed
          label: `${type} ${id.slice(0, 8)}...`,
          type,
          urlId: id,
        },
      });
      i += fullMatch.length;
      continue;
    }

    // Generic URL mentions: <url href="..." />
    if (text.substring(i).match(/^<url\s+href="([^"]+)"\s*\/>/)) {
      const match = text.substring(i).match(/^<url\s+href="([^"]+)"\s*\/>/);
      if (match) {
        flushText();
        const [fullMatch, href] = match;
        try {
          const urlObj = new URL(href);
          nodes.push({
            type: "mention",
            attrs: {
              id: href,
              label: urlObj.hostname,
              type: "generic",
            },
          });
        } catch {
          // Invalid URL, skip
        }
        i += fullMatch.length;
        continue;
      }
    }

    // File mentions: <file path="..." />
    if (text.substring(i).match(/^<file\s+path="([^"]+)"\s*\/>/)) {
      const match = text.substring(i).match(/^<file\s+path="([^"]+)"\s*\/>/);
      if (match) {
        flushText();
        const filePath = match[1];
        nodes.push({
          type: "mention",
          attrs: {
            id: filePath,
            label: filePath.split("/").pop() || filePath,
            type: "file",
          },
        });
        i += match[0].length;
        continue;
      }
    }

    // Links: [text](url)
    if (text[i] === "[") {
      const linkMatch = text.substring(i).match(/^\[([^\]]*)\]\(([^)]*)\)/);
      if (linkMatch) {
        flushText();
        nodes.push({
          type: "text",
          text: linkMatch[1],
          marks: [{ type: "link", attrs: { href: linkMatch[2] } }],
        });
        i += linkMatch[0].length;
        continue;
      }
    }

    // Bold: **text**
    if (text.substring(i, i + 2) === "**") {
      const boldMatch = text.substring(i).match(/^\*\*([^*]+)\*\*/);
      if (boldMatch) {
        flushText();
        nodes.push({
          type: "text",
          text: boldMatch[1],
          marks: [{ type: "bold" }],
        });
        i += boldMatch[0].length;
        continue;
      }
    }

    // Italic: *text*
    if (text[i] === "*" && text[i + 1] !== "*") {
      const italicMatch = text.substring(i).match(/^\*([^*]+)\*/);
      if (italicMatch) {
        flushText();
        nodes.push({
          type: "text",
          text: italicMatch[1],
          marks: [{ type: "italic" }],
        });
        i += italicMatch[0].length;
        continue;
      }
    }

    // Underline: <u>text</u>
    if (text.substring(i, i + 3) === "<u>") {
      const underlineMatch = text.substring(i).match(/^<u>([^<]+)<\/u>/);
      if (underlineMatch) {
        flushText();
        nodes.push({
          type: "text",
          text: underlineMatch[1],
          marks: [{ type: "underline" }],
        });
        i += underlineMatch[0].length;
        continue;
      }
    }

    // Strike: ~~text~~
    if (text.substring(i, i + 2) === "~~") {
      const strikeMatch = text.substring(i).match(/^~~([^~]+)~~/);
      if (strikeMatch) {
        flushText();
        nodes.push({
          type: "text",
          text: strikeMatch[1],
          marks: [{ type: "strike" }],
        });
        i += strikeMatch[0].length;
        continue;
      }
    }

    // Code: `text`
    if (text[i] === "`" && text.substring(i, i + 3) !== "```") {
      const codeMatch = text.substring(i).match(/^`([^`]+)`/);
      if (codeMatch) {
        flushText();
        nodes.push({
          type: "text",
          text: codeMatch[1],
          marks: [{ type: "code" }],
        });
        i += codeMatch[0].length;
        continue;
      }
    }

    // Regular character
    currentText += text[i];
    i++;
  }

  flushText();
  return nodes.length > 0 ? nodes : [{ type: "text", text: "" }];
}

/**
 * Extract file paths from markdown with XML tags
 */
export function extractFilePaths(markdown: string): string[] {
  const fileTagRegex = /<file\s+path="([^"]+)"\s*\/>/g;
  const paths: string[] = [];
  let match: RegExpExecArray | null;

  match = fileTagRegex.exec(markdown);
  while (match !== null) {
    paths.push(match[1]);
    match = fileTagRegex.exec(markdown);
  }

  return paths;
}
