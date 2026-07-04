import { describe, expect, it, vi } from "vitest";
import { resolveRtkSavings } from "./rtk-savings";

const GAIN_JSON = JSON.stringify({
  summary: {
    total_commands: 2,
    total_input: 502691,
    total_output: 5835,
    total_saved: 496856,
    avg_savings_pct: 98.8392471717218,
    total_time_ms: 3456,
    avg_time_ms: 1728,
  },
  daily: [],
});

function gain(stdout: string) {
  return vi.fn().mockResolvedValue(stdout);
}

describe("resolveRtkSavings", () => {
  it("parses the rtk gain summary into a typed savings object", async () => {
    const runGain = gain(GAIN_JSON);
    const savings = await resolveRtkSavings({
      resolveBinary: () => "/bundled/rtk",
      runGain,
    });

    expect(runGain).toHaveBeenCalledWith("/bundled/rtk", expect.anything());
    expect(savings).toEqual({
      totalCommands: 2,
      inputTokens: 502691,
      outputTokens: 5835,
      tokensSaved: 496856,
      avgSavingsPct: 98.8392471717218,
    });
  });

  it("does not run rtk when the binary is unresolved (disabled / not found)", async () => {
    const runGain = gain(GAIN_JSON);
    const savings = await resolveRtkSavings({
      resolveBinary: () => undefined,
      runGain,
    });

    expect(savings).toBeNull();
    expect(runGain).not.toHaveBeenCalled();
  });

  it.each([
    [
      "nothing was tracked (zero commands)",
      JSON.stringify({ summary: { total_commands: 0, total_saved: 0 } }),
    ],
    ["malformed JSON", "not json"],
    ["missing summary block", JSON.stringify({ daily: [] })],
    ["the payload is JSON null", "null"],
    ["the payload is a non-object", "42"],
  ])("returns null when %s", async (_label, stdout) => {
    const savings = await resolveRtkSavings({
      resolveBinary: () => "/bundled/rtk",
      runGain: gain(stdout),
    });

    expect(savings).toBeNull();
  });

  it("returns null when rtk gain throws rather than disrupting the run", async () => {
    const savings = await resolveRtkSavings({
      resolveBinary: () => "/bundled/rtk",
      runGain: vi.fn().mockRejectedValue(new Error("rtk exploded")),
    });

    expect(savings).toBeNull();
  });

  it("coerces missing or non-numeric fields to zero", async () => {
    const savings = await resolveRtkSavings({
      resolveBinary: () => "/bundled/rtk",
      runGain: gain(
        JSON.stringify({
          summary: {
            total_commands: 3,
            total_saved: "lots",
            avg_savings_pct: null,
          },
        }),
      ),
    });

    expect(savings).toEqual({
      totalCommands: 3,
      inputTokens: 0,
      outputTokens: 0,
      tokensSaved: 0,
      avgSavingsPct: 0,
    });
  });
});
