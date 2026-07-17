import type { Tab } from "./panelTypes";

export type AddableTabKind = "terminal" | "browser";

export interface TabAvailability {
  browserEnabled: boolean;
  terminalEnabled: boolean;
}

export function getAddableTabKinds({
  browserEnabled,
  terminalEnabled,
}: TabAvailability): AddableTabKind[] {
  const kinds: AddableTabKind[] = [];
  if (terminalEnabled) kinds.push("terminal");
  if (browserEnabled) kinds.push("browser");
  return kinds;
}

export function isPanelTabAvailable(
  type: Tab["data"]["type"],
  availability: TabAvailability,
): boolean {
  if (type === "terminal") return availability.terminalEnabled;
  if (type === "browser") return availability.browserEnabled;
  return true;
}
