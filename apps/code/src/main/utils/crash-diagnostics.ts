export interface MemorySnapshot {
  totalWorkingSetKb: number;
  peakWorkingSetKb: number;
  processCount: number;
  byType: Record<string, number>;
}

/**
 * Summarize per-process memory (from `app.getAppMetrics()`, passed in by the
 * caller so this stays free of a direct `electron` import) for crash
 * diagnostics. Working-set sizes are in KB. Attached to renderer/child crash
 * events so PostHog Error Tracking can show whether the app was under memory
 * pressure: a hard OOM kills the renderer before it can log anything, so the
 * chromium log usually goes silent and this is the only reliable signal.
 *
 * Defensive on purpose: a throw here would run before the crash handler's
 * auto-recovery reload, so failures return `undefined` instead.
 *
 * Caveat: at `render-process-gone` time the dead renderer is already gone from
 * the metrics, so the `Tab` total understates the renderer's real peak. The
 * `unresponsive` sample (renderer still alive) is the more telling one.
 */
export function collectMemorySnapshot(
  getMetrics: () => Electron.ProcessMetric[],
): MemorySnapshot | undefined {
  try {
    const metrics = getMetrics();
    let totalWorkingSetKb = 0;
    let peakWorkingSetKb = 0;
    const byType: Record<string, number> = {};
    for (const metric of metrics) {
      const workingSet = metric.memory.workingSetSize;
      totalWorkingSetKb += workingSet;
      peakWorkingSetKb = Math.max(
        peakWorkingSetKb,
        metric.memory.peakWorkingSetSize,
      );
      byType[metric.type] = (byType[metric.type] ?? 0) + workingSet;
    }
    return {
      totalWorkingSetKb,
      peakWorkingSetKb,
      processCount: metrics.length,
      byType,
    };
  } catch {
    return undefined;
  }
}
