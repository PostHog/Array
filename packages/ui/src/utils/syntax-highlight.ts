import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass } from "@codemirror/lang-sass";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import type { Parser } from "@lezer/common";
import {
  highlightCode as lezerHighlightCode,
  tags as t,
  tagHighlighter,
} from "@lezer/highlight";

type ColorKey =
  | "violet"
  | "coral"
  | "malibu"
  | "whiskey"
  | "ivory"
  | "chalky"
  | "cyan"
  | "stone"
  | "sage"
  | "invalid";

const darkPalette: Record<ColorKey, string> = {
  chalky: "#e5c07b",
  coral: "#e06c75",
  cyan: "#56b6c2",
  invalid: "#f7eddf",
  ivory: "#c4baa8",
  stone: "#8a8275",
  malibu: "#61afef",
  sage: "#98c379",
  whiskey: "#d19a66",
  violet: "#c678dd",
};

const lightPalette: Record<ColorKey, string> = {
  chalky: "#c18401",
  coral: "#c45649",
  cyan: "#0184bc",
  invalid: "#2d2b29",
  ivory: "#3d3832",
  stone: "#9a9282",
  malibu: "#4078f2",
  sage: "#50a14f",
  whiskey: "#986801",
  violet: "#a626a4",
};

const highlighter = tagHighlighter([
  { tag: t.keyword, class: "violet" },
  {
    tag: [t.name, t.deleted, t.character, t.propertyName, t.macroName],
    class: "coral",
  },
  { tag: [t.function(t.variableName), t.labelName], class: "malibu" },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], class: "whiskey" },
  { tag: [t.definition(t.name), t.separator], class: "ivory" },
  {
    tag: [
      t.typeName,
      t.className,
      t.number,
      t.changed,
      t.annotation,
      t.modifier,
      t.self,
      t.namespace,
    ],
    class: "chalky",
  },
  {
    tag: [
      t.operator,
      t.operatorKeyword,
      t.url,
      t.escape,
      t.regexp,
      t.link,
      t.special(t.string),
    ],
    class: "cyan",
  },
  { tag: [t.meta, t.comment], class: "stone" },
  { tag: t.heading, class: "coral" },
  { tag: [t.atom, t.bool, t.special(t.variableName)], class: "whiskey" },
  { tag: [t.processingInstruction, t.string, t.inserted], class: "sage" },
  { tag: t.invalid, class: "invalid" },
]);

type ParserFactory = () => Parser;

const FENCE_LANGUAGE_MAP: Record<string, ParserFactory> = {
  typescript: () => javascript({ jsx: true, typescript: true }).language.parser,
  ts: () => javascript({ jsx: true, typescript: true }).language.parser,
  javascript: () => javascript({ jsx: true }).language.parser,
  js: () => javascript({ jsx: true }).language.parser,
  jsx: () => javascript({ jsx: true }).language.parser,
  tsx: () => javascript({ jsx: true, typescript: true }).language.parser,
  python: () => python().language.parser,
  py: () => python().language.parser,
  rust: () => rust().language.parser,
  rs: () => rust().language.parser,
  go: () => go().language.parser,
  golang: () => go().language.parser,
  html: () => html().language.parser,
  css: () => css().language.parser,
  scss: () => sass({ indented: false }).language.parser,
  sass: () => sass({ indented: true }).language.parser,
  json: () => json().language.parser,
  yaml: () => yaml().language.parser,
  yml: () => yaml().language.parser,
  sql: () => sql().language.parser,
  java: () => java().language.parser,
  cpp: () => cpp().language.parser,
  c: () => cpp().language.parser,
  php: () => php().language.parser,
  xml: () => xml().language.parser,
  svg: () => xml().language.parser,
  markdown: () => markdown().language.parser,
  md: () => markdown().language.parser,
};

const parserCache = new Map<string, Parser>();

function getParser(language: string): Parser | null {
  const cached = parserCache.get(language);
  if (cached) return cached;

  const factory = FENCE_LANGUAGE_MAP[language];
  if (!factory) return null;

  const parser = factory();
  parserCache.set(language, parser);
  return parser;
}

export interface HighlightSegment {
  text: string;
  color?: string;
}

export function highlightSyntax(
  code: string,
  language: string,
  isDark: boolean,
): HighlightSegment[] | null {
  const parser = getParser(language);
  if (!parser) return null;

  const tree = parser.parse(code);
  const palette = isDark ? darkPalette : lightPalette;
  const segments: HighlightSegment[] = [];

  lezerHighlightCode(
    code,
    tree,
    highlighter,
    (text, classes) => {
      const colorKey = classes.split(" ")[0] as ColorKey;
      const color = colorKey ? palette[colorKey] : undefined;
      segments.push({ text, color });
    },
    () => {
      segments.push({ text: "\n" });
    },
  );

  return segments;
}
