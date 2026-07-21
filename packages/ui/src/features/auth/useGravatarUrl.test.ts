import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useGravatarUrl } from "./useGravatarUrl";

describe("useGravatarUrl", () => {
  it("returns undefined when there is no email", () => {
    const { result } = renderHook(() => useGravatarUrl(undefined));
    expect(result.current).toBeUndefined();
  });

  it("builds a SHA-256 Gravatar URL with the d=404 fallback", async () => {
    const { result } = renderHook(() => useGravatarUrl("user@example.com"));
    await waitFor(() =>
      expect(result.current).toBe(
        "https://www.gravatar.com/avatar/b4c9a289323b21a01c3e940f150eb9b8c542587f1abfd8f0e1cc1ffc5e475514?s=96&d=404",
      ),
    );
  });

  it("lowercases and trims the email before hashing", async () => {
    const { result } = renderHook(() => useGravatarUrl("  TEST@Example.com "));
    await waitFor(() =>
      expect(result.current).toBe(
        "https://www.gravatar.com/avatar/973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b?s=96&d=404",
      ),
    );
  });
});
