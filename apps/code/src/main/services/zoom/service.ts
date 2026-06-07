import type { IMainWindow } from "@posthog/platform/main-window";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import {
  clampZoomLevel,
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  ZOOM_STEP,
  type ZoomPersistence,
  ZoomServiceEvent,
  type ZoomServiceEvents,
  type ZoomState,
  zoomLevelToPercent,
} from "./schemas";

/**
 * Owns the window zoom level: applies it to the host window, persists it, and
 * broadcasts changes so the renderer can reflect the current percentage.
 *
 * The window's zoom resets to 0 on every web-contents reload, so {@link restore}
 * must be called after each load to re-apply the persisted level.
 */
@injectable()
export class ZoomService extends TypedEventEmitter<ZoomServiceEvents> {
  private currentLevel: number;

  constructor(
    @inject(MAIN_TOKENS.MainWindow)
    private readonly mainWindow: IMainWindow,
    @inject(MAIN_TOKENS.ZoomPersistence)
    private readonly persistence: ZoomPersistence,
  ) {
    super();
    this.currentLevel = clampZoomLevel(this.persistence.getZoomLevel());
  }

  /** Re-apply the persisted zoom level to the window (call after each load). */
  restore(): ZoomState {
    this.currentLevel = clampZoomLevel(this.persistence.getZoomLevel());
    this.mainWindow.setZoomLevel(this.currentLevel);
    return this.emitChange();
  }

  zoomIn(): ZoomState {
    return this.setLevel(this.currentLevel + ZOOM_STEP);
  }

  zoomOut(): ZoomState {
    return this.setLevel(this.currentLevel - ZOOM_STEP);
  }

  reset(): ZoomState {
    return this.setLevel(0);
  }

  setLevel(level: number): ZoomState {
    this.currentLevel = clampZoomLevel(level);
    this.mainWindow.setZoomLevel(this.currentLevel);
    this.persistence.setZoomLevel(this.currentLevel);
    return this.emitChange();
  }

  getState(): ZoomState {
    return {
      level: this.currentLevel,
      percent: zoomLevelToPercent(this.currentLevel),
      canZoomIn: this.currentLevel < MAX_ZOOM_LEVEL,
      canZoomOut: this.currentLevel > MIN_ZOOM_LEVEL,
    };
  }

  private emitChange(): ZoomState {
    const state = this.getState();
    this.emit(ZoomServiceEvent.Changed, state);
    return state;
  }
}
