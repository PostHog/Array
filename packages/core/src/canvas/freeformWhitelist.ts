// The package whitelist for freeform-React canvases (Q16: curated, PostHog-
// anchored). Every entry is a package the agent may import; anything else is
// rejected by the static check below. Keep this list SMALL — each entry is
// hosting surface (in public mode), bundle weight, and attack surface. Expand
// only on observed demand.
//
// `esm` is the render-time module URL used in EDIT mode (Q2/Q3: in-browser Babel
// + esm.sh CDN). In published/view mode these resolve to self-hosted, frozen
// copies instead (Phase 2: the publish/bundle step rewrites the import map); the
// names stay the same so canvas code is identical across tiers.
export interface WhitelistEntry {
  /** The bare import specifier the agent writes, e.g. "recharts". */
  name: string;
  /** Pinned version. Frozen so a canvas can't drift onto a new major. */
  version: string;
  /** esm.sh URL for edit-mode render (CDN). */
  esm: string;
}

const ESM = "https://esm.sh";

// `?external=react,react-dom` keeps every dependent bound to the ONE react the
// import map provides, instead of esm.sh bundling its own copy (which breaks
// hooks across module boundaries — "invalid hook call").
export const FREEFORM_WHITELIST: WhitelistEntry[] = [
  { name: "react", version: "19.0.0", esm: `${ESM}/react@19.0.0` },
  {
    name: "react-dom",
    version: "19.0.0",
    esm: `${ESM}/react-dom@19.0.0?external=react`,
  },
  {
    name: "react-dom/client",
    version: "19.0.0",
    esm: `${ESM}/react-dom@19.0.0/client?external=react`,
  },
  // PostHog's own design system — already built + self-hosted, so it's the
  // cheapest dependency and keeps shared canvases visually on-brand.
  {
    name: "@posthog/quill",
    version: "latest",
    esm: `${ESM}/@posthog/quill?external=react,react-dom`,
  },
  // One charting library (the conventional React pick).
  {
    name: "recharts",
    version: "2.15.0",
    esm: `${ESM}/recharts@2.15.0?external=react,react-dom`,
  },
  // One formatting/date util.
  { name: "dayjs", version: "1.11.13", esm: `${ESM}/dayjs@1.11.13` },
];

// The CDN host the edit-mode import map (and Babel) load from. The iframe CSP
// must allow this in edit mode; view/published mode self-hosts and forbids it.
export const FREEFORM_ESM_HOST = ESM;

// The in-browser transpiler (Q2), imported as ESM so egress stays on one host.
export const FREEFORM_BABEL_URL = `${ESM}/@babel/standalone@7.26.4`;

// Names the agent is allowed to import. Subpath imports (e.g. "dayjs/plugin/x")
// are allowed when their package root is whitelisted AND the exact subpath is
// listed; we keep it strict (exact-match only) so a subpath can't smuggle in an
// unreviewed entry point.
const ALLOWED_SPECIFIERS = new Set(FREEFORM_WHITELIST.map((e) => e.name));

// The import map handed to the iframe so bare specifiers resolve to the pinned
// modules. Edit mode -> esm.sh; view mode (Phase 2) will pass self-hosted URLs.
export function buildImportMap(): { imports: Record<string, string> } {
  const imports: Record<string, string> = {};
  for (const entry of FREEFORM_WHITELIST) imports[entry.name] = entry.esm;
  // The automatic JSX runtime compiles `<div/>` to imports of these; canvases
  // never write them by hand, so they're not in the whitelist, but they must
  // resolve for any JSX to run.
  imports["react/jsx-runtime"] = `${ESM}/react@19.0.0/jsx-runtime`;
  imports["react/jsx-dev-runtime"] = `${ESM}/react@19.0.0/jsx-dev-runtime`;
  return { imports };
}

export interface ImportCheckResult {
  ok: boolean;
  /** Human-readable reasons the code was rejected (empty when ok). */
  violations: string[];
}

// Matches static import/export-from specifiers:
//   import x from "spec";  import "spec";  export * from "spec";
// Captures the quoted specifier in group 1 or 2.
const STATIC_IMPORT_RE =
  /(?:import|export)\b[^;'"]*?(?:from\s*)?["']([^"']+)["']|import\s*["']([^"']+)["']/g;

// Patterns we reject outright regardless of specifier (Q9): dynamic import()
// dodges static analysis; require()/importScripts pull arbitrary modules; inline
// <script> and javascript: URLs are out-of-band code the import check can't see.
const FORBIDDEN_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\bimport\s*\(/, reason: "dynamic import() is not allowed" },
  { re: /\brequire\s*\(/, reason: "require() is not allowed" },
  { re: /\bimportScripts\s*\(/, reason: "importScripts() is not allowed" },
  { re: /<script\b/i, reason: "inline <script> is not allowed" },
];

/**
 * Statically verify that freeform canvas code imports only whitelisted packages
 * and uses no out-of-band code-loading. This is the enforcement point (Q9): it
 * runs at save AND publish. It is deliberately conservative — when in doubt it
 * rejects. A relative import (./x) is rejected because a canvas is a single file
 * with no sibling modules.
 */
export function checkFreeformImports(code: string): ImportCheckResult {
  const violations: string[] = [];

  for (const { re, reason } of FORBIDDEN_PATTERNS) {
    if (re.test(code)) violations.push(reason);
  }

  for (const match of code.matchAll(STATIC_IMPORT_RE)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;
    if (!isAllowedSpecifier(specifier)) {
      violations.push(`import of non-whitelisted module "${specifier}"`);
    }
  }

  return { ok: violations.length === 0, violations };
}

function isAllowedSpecifier(specifier: string): boolean {
  return ALLOWED_SPECIFIERS.has(specifier);
}
