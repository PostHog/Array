export const SIDEBAR_MIN_WIDTH = 240;

export const MORE_NAV_ITEMS = [
  { id: "search", label: "Search", defaultVisible: false },
  { id: "agents", label: "Agents", defaultVisible: true },
  { id: "skills", label: "Skills", defaultVisible: false },
  { id: "mcp-servers", label: "MCP servers", defaultVisible: false },
  { id: "usage", label: "Usage", defaultVisible: false },
  { id: "command-center", label: "Command Center", defaultVisible: true },
  { id: "contexts", label: "Contexts", defaultVisible: true },
  { id: "activity", label: "Activity", defaultVisible: true },
] as const;

export type MoreNavItemId = (typeof MORE_NAV_ITEMS)[number]["id"];

export const MORE_NAV_ITEM_IDS = MORE_NAV_ITEMS.map((item) => item.id);

export type NavItemOverrides = Partial<Record<MoreNavItemId, boolean>>;

const DEFAULT_VISIBILITY: Record<MoreNavItemId, boolean> = Object.fromEntries(
  MORE_NAV_ITEMS.map((item) => [item.id, item.defaultVisible]),
) as Record<MoreNavItemId, boolean>;

export function isNavItemVisible(
  overrides: NavItemOverrides,
  id: MoreNavItemId,
): boolean {
  return overrides[id] ?? DEFAULT_VISIBILITY[id];
}

/** Keeps only known item ids with boolean values, so corrupt or stale
 * persisted state degrades to per-item defaults instead of crashing. */
export function sanitizeNavItemOverrides(value: unknown): NavItemOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  const overrides: NavItemOverrides = {};
  for (const id of MORE_NAV_ITEM_IDS) {
    const entry = (value as Record<string, unknown>)[id];
    if (typeof entry === "boolean") overrides[id] = entry;
  }
  return overrides;
}
