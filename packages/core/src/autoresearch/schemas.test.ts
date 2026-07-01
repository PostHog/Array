import { describe, expect, it } from "vitest";
import {
  AUTORESEARCH_MAX_ITERATIONS_LIMIT,
  autoresearchConfigSchema,
} from "./schemas";

const validInput = {
  taskId: "task-1",
  metricName: "bundle size (kB)",
  direction: "minimize" as const,
  instructions: "Shrink the production bundle.",
};

describe("autoresearchConfigSchema", () => {
  it("parses a minimal config and applies defaults", () => {
    const config = autoresearchConfigSchema.parse(validInput);
    expect(config.targetValue).toBeNull();
    expect(config.maxIterations).toBe(10);
    expect(config.metricName).toBe("bundle size (kB)");
  });

  it("trims metric name and instructions", () => {
    const config = autoresearchConfigSchema.parse({
      ...validInput,
      metricName: "  latency p95  ",
      instructions: "  Reduce it.  ",
    });
    expect(config.metricName).toBe("latency p95");
    expect(config.instructions).toBe("Reduce it.");
  });

  it.each([
    ["empty metric name", { ...validInput, metricName: "   " }],
    ["empty instructions", { ...validInput, instructions: "" }],
    ["empty task id", { ...validInput, taskId: "" }],
    ["unknown direction", { ...validInput, direction: "increase" }],
    ["zero max iterations", { ...validInput, maxIterations: 0 }],
    ["fractional max iterations", { ...validInput, maxIterations: 2.5 }],
    [
      "max iterations above the limit",
      { ...validInput, maxIterations: AUTORESEARCH_MAX_ITERATIONS_LIMIT + 1 },
    ],
    ["non-finite target", { ...validInput, targetValue: Number.NaN }],
  ])("rejects %s", (_name, input) => {
    expect(autoresearchConfigSchema.safeParse(input).success).toBe(false);
  });

  it("accepts an explicit target and iteration budget", () => {
    const config = autoresearchConfigSchema.parse({
      ...validInput,
      targetValue: 150,
      maxIterations: 25,
    });
    expect(config.targetValue).toBe(150);
    expect(config.maxIterations).toBe(25);
  });
});
