export interface HedgehogModeHandle {
  destroy(): void;
}

export interface HedgehogModeMountOptions {
  /** Raw `hedgehog_config.actor_options` from the user profile; the host casts it. */
  actorOptions?: unknown;
  /** Called when the user quits hedgehog mode from within the game. */
  onQuit: () => void;
}

/**
 * Host capability for the optional hedgehog-mode overlay. The desktop adapter
 * owns the `@posthog/hedgehog-mode` (DOM/canvas) library; the ui component only
 * mounts/destroys through this port so packages/ui stays environment-agnostic.
 * A host that does not support hedgehogs simply leaves it unset (no-op).
 */
export interface HedgehogModeHost {
  mount(
    container: HTMLDivElement,
    options: HedgehogModeMountOptions,
  ): Promise<HedgehogModeHandle>;
}

export const HEDGEHOG_MODE_HOST = Symbol.for("posthog.ui.HedgehogModeHost");
