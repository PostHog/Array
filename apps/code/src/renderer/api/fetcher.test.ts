import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildApiFetcher } from "./fetcher";

describe("buildApiFetcher", () => {
  const mockFetch = vi.fn();
  const mockInput = {
    method: "get" as const,
    url: new URL("https://api.example.com/test"),
    path: "/test",
  };
  const ok = (data = {}) => ({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  });
  const err = (status: number) => {
    const response = {
      ok: false,
      status,
      statusText: `Error ${status}`,
      json: () => Promise.resolve({ error: status }),
      clone: () => ({
        ...response,
        text: () => Promise.resolve(`Error ${status}`),
      }),
    };
    return response;
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("makes request with a token fetched from the provider", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("my-token");
    const refreshAccessToken = vi.fn().mockResolvedValue("new-token");
    mockFetch.mockResolvedValueOnce(ok());

    const fetcher = buildApiFetcher({ getAccessToken, refreshAccessToken });
    await fetcher.fetch(mockInput);

    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls[0][1].headers.get("Authorization")).toBe(
      "Bearer my-token",
    );
  });

  it("retries once with a freshly fetched token on 401", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("old-token");
    const refreshAccessToken = vi.fn().mockResolvedValue("new-token");
    mockFetch.mockResolvedValueOnce(err(401)).mockResolvedValueOnce(ok());

    const fetcher = buildApiFetcher({ getAccessToken, refreshAccessToken });
    const response = await fetcher.fetch(mockInput);

    expect(response.ok).toBe(true);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[1][1].headers.get("Authorization")).toBe(
      "Bearer new-token",
    );
  });

  it("does not retry on non-401 errors", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("token");
    const refreshAccessToken = vi.fn().mockResolvedValue("new-token");
    mockFetch.mockResolvedValueOnce(err(403));

    const fetcher = buildApiFetcher({ getAccessToken, refreshAccessToken });

    await expect(fetcher.fetch(mockInput)).rejects.toThrow("[403]");
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(refreshAccessToken).not.toHaveBeenCalled();
  });

  it("throws when the retry still returns 401", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("token-1");
    const refreshAccessToken = vi.fn().mockResolvedValue("token-2");
    mockFetch.mockResolvedValueOnce(err(401)).mockResolvedValueOnce(err(401));

    const fetcher = buildApiFetcher({ getAccessToken, refreshAccessToken });

    await expect(fetcher.fetch(mockInput)).rejects.toThrow("[401]");
  });

  it("throws when refetching a token fails during retry", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("token");
    const refreshAccessToken = vi
      .fn()
      .mockRejectedValueOnce(new Error("failed"));
    mockFetch.mockResolvedValueOnce(err(401));

    const fetcher = buildApiFetcher({ getAccessToken, refreshAccessToken });

    await expect(fetcher.fetch(mockInput)).rejects.toThrow("[401]");
  });

  it("handles network errors", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network failure"));
    const fetcher = buildApiFetcher({
      getAccessToken: vi.fn().mockResolvedValue("token"),
      refreshAccessToken: vi.fn().mockResolvedValue("new-token"),
    });

    await expect(fetcher.fetch(mockInput)).rejects.toThrow(
      "Network request failed",
    );
  });
});
