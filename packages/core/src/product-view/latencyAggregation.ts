/**
 * Rolling latency aggregation over live network samples captured on the
 * embedded page (CDP). Keys are caller-defined — a whole view or one
 * element's attributed requests. Pure and bounded.
 */

export interface LatencySnapshot {
  count: number;
  p50: number;
  p95: number;
  p99: number;
}

const DEFAULT_MAX_SAMPLES = 500;

export class LatencySampleBuffer {
  private readonly samples = new Map<string, number[]>();

  constructor(private readonly maxSamplesPerKey = DEFAULT_MAX_SAMPLES) {}

  add(key: string, durationMs: number): void {
    let list = this.samples.get(key);
    if (!list) {
      list = [];
      this.samples.set(key, list);
    }
    list.push(durationMs);
    if (list.length > this.maxSamplesPerKey) {
      list.splice(0, list.length - this.maxSamplesPerKey);
    }
  }

  snapshot(key: string): LatencySnapshot | null {
    const list = this.samples.get(key);
    if (!list || list.length === 0) return null;
    const sorted = [...list].sort((a, b) => a - b);
    const at = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
    return {
      count: sorted.length,
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
    };
  }

  clear(prefix: string): void {
    for (const key of this.samples.keys()) {
      if (key.startsWith(prefix)) this.samples.delete(key);
    }
  }
}
