import { afterEach, describe, expect, it, vi } from "vitest";
import { detectTimezone } from "./timezone";

describe("detectTimezone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an IANA timezone string in the happy path", () => {
    const tz = detectTimezone();
    expect(typeof tz).toBe("string");
    expect(tz.length).toBeGreaterThan(0);
  });

  it("falls back to UTC when Intl throws", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("nope");
    });
    expect(detectTimezone()).toBe("UTC");
  });

  it("falls back to UTC when resolvedOptions returns an empty timezone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: "" }) as never,
        }) as never,
    );
    expect(detectTimezone()).toBe("UTC");
  });
});
