import type { QuestionAnswer } from "@shared/types";

export interface ParsedQuestion {
  id: string;
  question: string;
  options: string[];
}

/**
 * Parse research.md markdown to extract questions
 * Handles multiple formats:
 * ## Question 1: Question text
 * ### 1. **Question text**
 * ### Question 1: Question text
 */
export function parseResearchMarkdown(content: string): ParsedQuestion[] {
  const questions: ParsedQuestion[] = [];
  const lines = content.split("\n");

  console.log(
    "[parseResearchMarkdown] Parsing research.md with",
    lines.length,
    "lines",
  );

  let questionCounter = 1;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    // Look for question headers - support both ## and ###
    // Patterns: "## Question N:", "### N. **Text**", "### Question N:"
    const h2Match = line.match(/^##\s+Question\s+\d+:\s*(.+)/i);
    const h3NumberedMatch = line.match(/^###\s+\d+\.\s+\*\*(.+?)\*\*/);
    const h3QuestionMatch = line.match(/^###\s+Question\s+\d+:\s*(.+)/i);

    let questionText = "";
    if (h2Match) {
      questionText = h2Match[1].trim();
    } else if (h3NumberedMatch) {
      questionText = h3NumberedMatch[1].trim();
    } else if (h3QuestionMatch) {
      questionText = h3QuestionMatch[1].trim();
    }

    if (questionText) {
      console.log("[parseResearchMarkdown] Found question:", questionText);
      // Found a question header, now look for options
      i++;
      const options: string[] = [];
      let foundOptionsMarker = false;

      // Scan ahead for options (look up to 20 lines ahead)
      const maxLookAhead = Math.min(i + 20, lines.length);
      while (i < maxLookAhead) {
        const currentLine = lines[i].trim();

        // Check for "Options:" or "Should" marker
        if (
          currentLine.toLowerCase().includes("options:") ||
          currentLine.toLowerCase().startsWith("should")
        ) {
          foundOptionsMarker = true;
          i++;
          continue;
        }

        // Extract option lines (support both - and *)
        if (currentLine.match(/^[-*]\s*[a-z]\)/i)) {
          const option = currentLine.replace(/^[-*]\s*/, "").trim();
          if (option) {
            options.push(option);
            console.log(
              "[parseResearchMarkdown]   Option:",
              option.substring(0, 50),
            );
          }
          i++;
          continue;
        }

        // Stop at next heading
        if (currentLine.startsWith("##") || currentLine.startsWith("###")) {
          break;
        }

        // Stop if we found options and hit 2+ empty lines
        if (foundOptionsMarker && options.length > 0 && !currentLine) {
          break;
        }

        i++;
      }

      // Only add if we found at least 2 options
      if (options.length >= 2) {
        questions.push({
          id: `q${questionCounter}`,
          question: questionText,
          options,
        });
        questionCounter++;
        console.log(
          "[parseResearchMarkdown] Added question",
          questionCounter - 1,
          "with",
          options.length,
          "options",
        );
      } else {
        console.log(
          "[parseResearchMarkdown] Skipping question - insufficient options:",
          options.length,
        );
      }
    } else {
      i++;
    }
  }

  console.log(
    "[parseResearchMarkdown] Total questions parsed:",
    questions.length,
  );
  return questions;
}

/**
 * Format question answers as markdown to append to research.md
 */
export function formatAnswersMarkdown(answers: QuestionAnswer[]): string {
  let markdown = "\n\n## Answers\n\n";

  for (let i = 0; i < answers.length; i++) {
    const answer = answers[i];
    markdown += `### Question ${i + 1}\n\n`;
    markdown += `**Selected:** ${answer.selectedOption}\n\n`;

    if (answer.customInput) {
      markdown += `**Details:** ${answer.customInput}\n\n`;
    }
  }

  return markdown;
}
