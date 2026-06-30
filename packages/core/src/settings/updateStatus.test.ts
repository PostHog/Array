import { describe, expect, it } from "vitest";
import { deriveUpdateStatus, resolveCheckResultAction } from "./updateStatus";

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

describe("resolveCheckResultAction", () => {
  it("returns null on success so the subscription owns the status", () => {
    expect(resolveCheckResultAction({ success: true })).toBeNull();
  });

  it("returns null while a check is already in progress", () => {
    expect(
      resolveCheckResultAction({
        success: false,
        errorCode: "already_checking",
      }),
    ).toBeNull();
  });

  it("flags updates disabled and surfaces the reason", () => {
    expect(
      resolveCheckResultAction({
        success: false,
        errorCode: "disabled",
        errorMessage: "Updates only available in packaged builds",
      }),
    ).toEqual({
      updatesDisabled: true,
      message: "Updates only available in packaged builds",
      type: "error",
    });
  });

  it("surfaces a generic failure when no message is provided", () => {
    expect(resolveCheckResultAction({ success: false })).toEqual({
      updatesDisabled: false,
      message: "Failed to check for updates",
      type: "error",
    });
  });
});
