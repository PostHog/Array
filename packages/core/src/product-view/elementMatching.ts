import type { EmbeddedBrowserElement } from "@posthog/platform/embedded-browser";

/**
 * Matching live DOM elements (descriptors reported by the in-page inspector)
 * against PostHog `elements/stats` rows (parsed autocapture chains). This is
 * the overlay's core correctness problem, so it's pure and heavily tested.
 *
 * A chain walks innermost → root, and clicks often land on decorative inner
 * nodes (a span inside the anchor) — so each row is matched against its first
 * few chain links, with key strength ordered data-attr > id > href > tag+text.
 */

export interface ElementStatsChainLink {
  tagName: string;
  text: string | null;
  href: string | null;
  attrId: string | null;
  dataAttr: string | null;
}

export type ElementStatsRowType = "$autocapture" | "$rageclick" | "$dead_click";

export interface ElementStatsRow {
  count: number;
  type: ElementStatsRowType;
  /** Innermost link first. */
  chain: ElementStatsChainLink[];
}

export interface ElementUsageStats {
  clicks: number;
  rageclicks: number;
  deadclicks: number;
}

/** How deep into a chain a click is still attributed to a live element —
 * covers icon/span/inner-div indirection without matching page scaffolding. */
const CHAIN_MATCH_DEPTH = 3;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const normalizeText = (value: string | null): string | null =>
  value ? value.replace(/\s+/g, " ").trim() || null : null;

/** Parse the raw `/elements/stats/` JSON into typed rows. Malformed rows are
 * dropped wholesale — a partially-parsed chain would mis-attribute counts. */
export function shapeElementStatsResponse(json: unknown): ElementStatsRow[] {
  if (typeof json !== "object" || json === null) return [];
  const results = (json as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const rows: ElementStatsRow[] = [];
  for (const raw of results) {
    if (typeof raw !== "object" || raw === null) continue;
    const { count, type, elements } = raw as {
      count?: unknown;
      type?: unknown;
      elements?: unknown;
    };
    if (typeof count !== "number" || !Array.isArray(elements)) continue;
    if (
      type !== "$autocapture" &&
      type !== "$rageclick" &&
      type !== "$dead_click"
    ) {
      continue;
    }
    const chain: ElementStatsChainLink[] = [];
    for (const link of elements) {
      if (typeof link !== "object" || link === null) continue;
      const l = link as Record<string, unknown>;
      const attributes =
        typeof l.attributes === "object" && l.attributes !== null
          ? (l.attributes as Record<string, unknown>)
          : {};
      const tagName = asString(l.tag_name);
      if (!tagName) continue;
      chain.push({
        tagName,
        text: normalizeText(asString(l.text)),
        href: asString(l.href) ?? asString(attributes.attr__href),
        attrId: asString(l.attr_id) ?? asString(attributes.attr__id),
        dataAttr: asString(attributes["attr__data-attr"]),
      });
    }
    if (chain.length === 0) continue;
    rows.push({ count, type, chain });
  }
  return rows;
}

interface DescriptorIndex {
  byDataAttr: Map<string, string>;
  byId: Map<string, string>;
  byHref: Map<string, string>;
  byTagText: Map<string, string>;
}

/** Index keys that resolve to exactly one descriptor; ambiguous keys are
 * dropped so a shared label can't attribute one row to several elements. */
function indexDescriptors(
  descriptors: EmbeddedBrowserElement[],
): DescriptorIndex {
  const build = (key: (d: EmbeddedBrowserElement) => string | null) => {
    const map = new Map<string, string>();
    const ambiguous = new Set<string>();
    for (const d of descriptors) {
      const k = key(d);
      if (!k) continue;
      if (map.has(k) && map.get(k) !== d.selectorHash) ambiguous.add(k);
      else map.set(k, d.selectorHash);
    }
    for (const k of ambiguous) map.delete(k);
    return map;
  };
  return {
    byDataAttr: build((d) => d.dataAttr),
    byId: build((d) => d.id),
    byHref: build((d) => d.href),
    byTagText: build((d) =>
      d.text ? `${d.tag}|${normalizeText(d.text)}` : null,
    ),
  };
}

function resolveRow(
  index: DescriptorIndex,
  row: ElementStatsRow,
): string | null {
  const depth = Math.min(CHAIN_MATCH_DEPTH, row.chain.length);
  // Strongest key across the whole window beats a weaker key found earlier —
  // the innermost link is often a decorative span whose text also appears on
  // an unrelated element.
  const lookups: Array<
    [keyof DescriptorIndex, (l: ElementStatsChainLink) => string | null]
  > = [
    ["byDataAttr", (l) => l.dataAttr],
    ["byId", (l) => l.attrId],
    ["byHref", (l) => l.href],
    ["byTagText", (l) => (l.text ? `${l.tagName}|${l.text}` : null)],
  ];
  for (const [mapName, key] of lookups) {
    for (let i = 0; i < depth; i++) {
      const k = key(row.chain[i]);
      if (!k) continue;
      const hit = index[mapName].get(k);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * Attribute stats rows to live elements. Returns only elements with at least
 * one matched row — an unmatched element gets NO entry (never a false zero).
 */
export function matchElementStats(
  descriptors: EmbeddedBrowserElement[],
  rows: ElementStatsRow[],
): Map<string, ElementUsageStats> {
  const index = indexDescriptors(descriptors);
  const stats = new Map<string, ElementUsageStats>();
  for (const row of rows) {
    const selectorHash = resolveRow(index, row);
    if (!selectorHash) continue;
    const entry = stats.get(selectorHash) ?? {
      clicks: 0,
      rageclicks: 0,
      deadclicks: 0,
    };
    if (row.type === "$autocapture") entry.clicks += row.count;
    else if (row.type === "$rageclick") entry.rageclicks += row.count;
    else entry.deadclicks += row.count;
    stats.set(selectorHash, entry);
  }
  return stats;
}
