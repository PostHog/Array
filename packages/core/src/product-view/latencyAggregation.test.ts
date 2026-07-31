import { describe, expect, it } from "vitest";
import { LatencySampleBuffer } from "./latencyAggregation";

describe("LatencySampleBuffer", () => {
  it("returns null for keys with no samples", () => {
    const buffer = new LatencySampleBuffer();
    expect(buffer.snapshot("nope")).toBeNull();
  });

  it("computes count and percentiles", () => {
    const buffer = new LatencySampleBuffer();
    for (let i = 1; i <= 100; i++) buffer.add("k", i);
    const snap = buffer.snapshot("k");
    expect(snap).toMatchObject({ count: 100, p50: 50, p95: 95, p99: 99 });
  });

  it("keeps only the most recent samples per key", () => {
    const buffer = new LatencySampleBuffer(10);
    for (let i = 1; i <= 100; i++) buffer.add("k", i);
    const snap = buffer.snapshot("k");
    // Only 91..100 retained.
    expect(snap?.count).toBe(10);
    expect(snap?.p50).toBeGreaterThanOrEqual(91);
  });

  it("isolates keys", () => {
    const buffer = new LatencySampleBuffer();
    buffer.add("a", 10);
    buffer.add("b", 1000);
    expect(buffer.snapshot("a")?.p50).toBe(10);
    expect(buffer.snapshot("b")?.p50).toBe(1000);
  });
});
