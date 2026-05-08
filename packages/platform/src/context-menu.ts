export interface ContextMenuAction {
  label: string;
  icon?: string;
  enabled?: boolean;
  accelerator?: string;
  submenu?: ContextMenuItem[];
  /** When defined, renders as a native checkbox item with a tick when `checked` is true. */
  checked?: boolean;
  click: () => void | Promise<void>;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuItem = ContextMenuAction | ContextMenuSeparator;

export interface ShowContextMenuOptions {
  onDismiss?: () => void;
}

export interface IContextMenu {
  show(items: ContextMenuItem[], options?: ShowContextMenuOptions): void;
}
