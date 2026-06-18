import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadFile, MAX_DOWNLOAD_ATTEMPTS } from "./download-binaries.mjs";

vi.mock("node:timers/promises", () => {
  const setTimeout = vi.fn(() => Promise.resolve());
  return { setTimeout, default: { setTimeout } };
});
vi.mock("node:stream/promises", () => {
  const pipeline = vi.fn(() => Promise.resolve());
  return { pipeline, default: { pipeline } };
});
vi.mock("node:fs", () => {
  const fns = {
    chmodSync: vi.fn(),
    createWriteStream: vi.fn(() => ({})),
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    realpathSync: vi.fn(() => "/not/the/entrypoint"),
    rmSync: vi.fn(),
  };
  return { ...fns, default: fns };
});

const okResponse = () => ({
  ok: true,
  status: 200,
  statusText: "OK",
  body: {},
});
const errorResponse = (status, statusText) => ({
  ok: false,
  status,
  statusText,
  body: null,
});

describe("downloadFile", () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloads on the first attempt without retrying", async () => {
    fetchMock.mockResolvedValue(okResponse());

    await downloadFile("https://example.test/bin.tar.gz", "/tmp/bin.tar.gz");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries retriable HTTP statuses then succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(503, "Service Unavailable"))
      .mockResolvedValueOnce(errorResponse(504, "Gateway Time-out"))
      .mockResolvedValueOnce(okResponse());

    await downloadFile("u", "/tmp/bin");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("fails fast on non-retriable HTTP statuses", async () => {
    fetchMock.mockResolvedValue(errorResponse(404, "Not Found"));

    await expect(downloadFile("u", "/tmp/bin")).rejects.toThrow("HTTP 404");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries network-level errors that carry no HTTP status", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse());

    await downloadFile("u", "/tmp/bin");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after MAX_DOWNLOAD_ATTEMPTS and rethrows the last error", async () => {
    fetchMock.mockResolvedValue(errorResponse(503, "Service Unavailable"));

    await expect(downloadFile("u", "/tmp/bin")).rejects.toThrow("HTTP 503");
    expect(fetchMock).toHaveBeenCalledTimes(MAX_DOWNLOAD_ATTEMPTS);
    expect(sleep).toHaveBeenCalledTimes(MAX_DOWNLOAD_ATTEMPTS - 1);
  });

  it("backs off exponentially with jitter inside the expected bounds", async () => {
    fetchMock.mockResolvedValue(errorResponse(503, "Service Unavailable"));

    await expect(downloadFile("u", "/tmp/bin")).rejects.toThrow();

    const delays = sleep.mock.calls.map(([ms]) => ms);
    expect(delays).toHaveLength(MAX_DOWNLOAD_ATTEMPTS - 1);
    delays.forEach((delay, i) => {
      const base = Math.min(1000 * 2 ** i, 15000);
      expect(delay).toBeGreaterThanOrEqual(base * 0.5);
      expect(delay).toBeLessThan(base);
    });
  });
});
