export const SIDEBAR_MIN_WIDTH = 240;

export const MORE_NAV_ITEMS = [
  { id: "search", label: "Search" },
  { id: "skills", label: "Skills" },
  { id: "mcp-servers", label: "MCP servers" },
] as const;

export type MoreNavItemId = (typeof MORE_NAV_ITEMS)[number]["id"];

export const MORE_NAV_ITEM_IDS = MORE_NAV_ITEMS.map((item) => item.id);
