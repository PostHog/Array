import { describe, expect, it } from "vitest";
import {
  getErrorMessage,
  isAuthError,
  isFatalSessionError,
  isNotAuthenticatedError,
  isRateLimitError,
  NotAuthenticatedError,
} from "./errors";

describe("NotAuthenticatedError", () => {
  it("has the expected name and a default message", () => {
    const err = new NotAuthenticatedError();
    expect(err.name).toBe("NotAuthenticatedError");
    expect(err.message).toBe("Not authenticated");
  });

  it("accepts a custom message", () => {
    expect(new NotAuthenticatedError("token gone").message).toBe("token gone");
  });
});

describe("isNotAuthenticatedError", () => {
  it("recognises a real NotAuthenticatedError", () => {
    expect(isNotAuthenticatedError(new NotAuthenticatedError())).toBe(true);
  });

  it("recognises a structurally tagged object", () => {
    expect(isNotAuthenticatedError({ name: "NotAuthenticatedError" })).toBe(
      true,
    );
  });

  it("rejects a plain Error and non-objects", () => {
    expect(isNotAuthenticatedError(new Error("nope"))).toBe(false);
    expect(isNotAuthenticatedError(null)).toBe(false);
    expect(isNotAuthenticatedError("NotAuthenticatedError")).toBe(false);
  });
});

describe("getErrorMessage", () => {
  it("reads the message from an Error", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("reads the message from a message-bearing object", () => {
    expect(getErrorMessage({ message: 42 })).toBe("42");
  });

  it("returns an empty string for valueless inputs", () => {
    expect(getErrorMessage(null)).toBe("");
    expect(getErrorMessage("just a string")).toBe("");
  });
});

describe("isAuthError", () => {
  it.each([
    "Authentication required",
    "Failed to authenticate",
    "authentication_error",
    "authentication_failed",
    "Access token has expired",
  ])("matches the auth pattern in %j (case-insensitive)", (message) => {
    expect(isAuthError(new Error(message))).toBe(true);
  });

  it("returns false for unrelated and empty errors", () => {
    expect(isAuthError(new Error("disk full"))).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});

describe("isRateLimitError", () => {
  it("matches rate-limit patterns in the message or the details", () => {
    expect(isRateLimitError("Rate limit exceeded")).toBe(true);
    expect(isRateLimitError("oops", "rate_limit hit")).toBe(true);
    expect(isRateLimitError("server said [429]")).toBe(true);
  });

  it("returns false when neither message nor details match", () => {
    expect(isRateLimitError("network down", "timeout")).toBe(false);
  });
});

describe("isFatalSessionError", () => {
  it.each([
    "internal error",
    "process exited",
    "session did not end",
    "not ready for writing",
    "session not found",
  ])("treats %j as fatal", (message) => {
    expect(isFatalSessionError(message)).toBe(true);
  });

  it("does not treat a rate-limit error as fatal even if a fatal phrase is present", () => {
    expect(isFatalSessionError("process exited", "rate limit exceeded")).toBe(
      false,
    );
  });

  it("returns false for ordinary recoverable errors", () => {
    expect(isFatalSessionError("temporary network blip")).toBe(false);
  });
});
