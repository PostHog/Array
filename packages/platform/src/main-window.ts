export interface IMainWindow {
  focus(): void;
  isFocused(): boolean;
  isMinimized(): boolean;
  restore(): void;
  onFocus(handler: () => void): () => void;
  /** Current zoom level (0 = 100%, each unit ~= a 1.2x factor). */
  getZoomLevel(): number;
  /** Set the window zoom level. Resets on every web-contents reload. */
  setZoomLevel(level: number): void;
}
