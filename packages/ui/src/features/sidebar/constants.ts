export const SIDEBAR_MIN_WIDTH = 240;

export const CUSTOMIZABLE_NAV_ITEMS = [
  { id: "search", label: "Search", defaultVisible: false },
  { id: "inbox", label: "Inbox", defaultVisible: true },
  { id: "agents", label: "Agents", defaultVisible: true },
  { id: "skills", label: "Skills", defaultVisible: true },
  { id: "mcp-servers", label: "MCP servers", defaultVisible: true },
  { id: "usage", label: "Usage", defaultVisible: false },
  { id: "command-center", label: "Command Center", defaultVisible: true },
  { id: "contexts", label: "Contexts", defaultVisible: true },
  { id: "activity", label: "Activity", defaultVisible: true },
] as const;

export type CustomizableNavItemId =
  (typeof CUSTOMIZABLE_NAV_ITEMS)[number]["id"];

export const CUSTOMIZABLE_NAV_ITEM_IDS = CUSTOMIZABLE_NAV_ITEMS.map(
  (item) => item.id,
);

export type NavItemOverrides = Partial<Record<CustomizableNavItemId, boolean>>;

const DEFAULT_VISIBILITY: Record<CustomizableNavItemId, boolean> =
  Object.fromEntries(
    CUSTOMIZABLE_NAV_ITEMS.map((item) => [item.id, item.defaultVisible]),
  ) as Record<CustomizableNavItemId, boolean>;

export function isNavItemVisible(
  overrides: NavItemOverrides,
  id: CustomizableNavItemId,
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
  for (const id of CUSTOMIZABLE_NAV_ITEM_IDS) {
    const entry = (value as Record<string, unknown>)[id];
    if (typeof entry === "boolean") overrides[id] = entry;
  }
  return overrides;
}
