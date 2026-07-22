import { afterEach, describe, expect, it, vi } from "vitest";
import { systemTimezone } from "./loopTimezone";

describe("systemTimezone", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the runtime IANA timezone", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "America/New_York" }),
    } as Intl.DateTimeFormat);

    expect(systemTimezone()).toBe("America/New_York");
  });

  it("falls back to UTC when timezone detection fails", () => {
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("unavailable");
    });

    expect(systemTimezone()).toBe("UTC");
  });
});
