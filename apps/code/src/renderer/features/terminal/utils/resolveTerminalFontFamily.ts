import type { TerminalFont } from "@features/settings/stores/settingsStore";

const FALLBACK =
  '"Berkeley Mono", "JetBrains Mono", "Consolas", "Monaco", monospace';

export const DEFAULT_TERMINAL_FONT_FAMILY = `"Berkeley Mono", ${FALLBACK}`;

function normalizeFontFamily(input: string): string {
  return input
    .split(",")
    .map((piece) =>
      piece
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .trim(),
    )
    .filter((piece) => piece.length > 0)
    .map((piece) => `"${piece}"`)
    .join(", ");
}

export function resolveTerminalFontFamily(
  font: TerminalFont,
  customFontFamily: string,
): string {
  switch (font) {
    case "berkeley-mono":
      return `"Berkeley Mono", ${FALLBACK}`;
    case "jetbrains-mono":
      return `"JetBrains Mono", ${FALLBACK}`;
    case "system":
      return "ui-monospace, Menlo, Monaco, Consolas, monospace";
    case "custom": {
      const normalized = normalizeFontFamily(customFontFamily);
      return normalized.length > 0 ? `${normalized}, ${FALLBACK}` : FALLBACK;
    }
  }
}
