export type RendererCrashRecoveryAction = "reload" | "reset-route" | "stop";

type RendererCrashRecoveryOptions = {
  crashLoopThreshold: number;
  crashLoopWindowMs: number;
};

export class RendererCrashRecovery {
  private readonly recentCrashTimestamps: number[] = [];

  constructor(private readonly options: RendererCrashRecoveryOptions) {}

  nextAction(now = Date.now()): RendererCrashRecoveryAction {
    while (
      this.recentCrashTimestamps.length > 0 &&
      now - this.recentCrashTimestamps[0] > this.options.crashLoopWindowMs
    ) {
      this.recentCrashTimestamps.shift();
    }

    this.recentCrashTimestamps.push(now);
    if (this.recentCrashTimestamps.length >= this.options.crashLoopThreshold) {
      return "stop";
    }
    return this.recentCrashTimestamps.length === 1 ? "reload" : "reset-route";
  }

  get recentCrashCount(): number {
    return this.recentCrashTimestamps.length;
  }
}

export function toSafeRendererUrl(rendererUrl: string): string {
  const url = new URL(rendererUrl);
  url.hash = "";
  return url.toString();
}
