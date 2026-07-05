import type { HedgehogActorOptions } from "@posthog/hedgehog-mode";
import type {
  HedgehogModeHandle,
  HedgehogModeHost,
  HedgehogModeMountOptions,
} from "@posthog/ui/shell/hedgehogModeHost";

export class RendererHedgehogModeHost implements HedgehogModeHost {
  async mount(
    container: HTMLDivElement,
    options: HedgehogModeMountOptions,
  ): Promise<HedgehogModeHandle> {
    const { HedgeHogMode } = await import("@posthog/hedgehog-mode");
    const actorOptions = options.actorOptions as
      | HedgehogActorOptions
      | undefined;

    const game = new HedgeHogMode({
      assetsUrl: "./hedgehog-mode",
      state: actorOptions ? { options: actorOptions } : undefined,
      onQuit: (g) => {
        g.getAllHedgehogs().forEach((hedgehog) => {
          hedgehog.updateSprite("wave", { reset: true, loop: false });
        });
        setTimeout(() => options.onQuit(), 1000);
      },
    });

    await game.render(container);

    return {
      destroy: () => game.destroy(),
    };
  }
}
