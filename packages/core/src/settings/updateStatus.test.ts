import { describe, expect, it } from "vitest";
import { deriveUpdateStatus } from "./updateStatus";

describe("deriveUpdateStatus", () => {
  it("reports downloading", () => {
    expect(deriveUpdateStatus({ checking: true, downloading: true })).toEqual({
      message: "Downloading update...",
      type: "info",
      checking: true,
    });
  });

  it("reports up to date", () => {
    expect(deriveUpdateStatus({ checking: false, upToDate: true })).toEqual({
      message: "You're on the latest version",
      type: "success",
      checking: false,
    });
  });

  it("reports an update ready with a version", () => {
    expect(
      deriveUpdateStatus({
        checking: false,
        updateReady: true,
        version: "1.2.3",
      }),
    ).toEqual({
      message: "Update 1.2.3 ready to install",
      type: "success",
      checking: false,
    });
  });

  it("reports an update ready without a version", () => {
    expect(deriveUpdateStatus({ checking: false, updateReady: true })).toEqual({
      message: "Update ready to install",
      type: "success",
      checking: false,
    });
  });

  it("clears checking when finished with no other signal", () => {
    expect(deriveUpdateStatus({ checking: false })).toEqual({
      checking: false,
    });
  });

  it("returns empty while still checking", () => {
    expect(deriveUpdateStatus({ checking: true })).toEqual({});
  });
});
