import type http from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { AuthService } from "../auth/service";
import { AuthProxyService } from "./service";

function createService(authenticatedFetch: ReturnType<typeof vi.fn>) {
  const authService = { authenticatedFetch } as unknown as AuthService;
  return new AuthProxyService(authService);
}

function createMockResponse() {
  const res = {
    _sent: false,
    writeHead: vi.fn(function writeHead(this: { _sent: boolean }) {
      res._sent = true;
    }),
    write: vi.fn(() => true),
    end: vi.fn(),
    destroy: vi.fn(),
    once: vi.fn(),
    get headersSent() {
      return res._sent;
    },
  };
  return res as unknown as http.ServerResponse & typeof res;
}

describe("AuthProxyService.forwardRequest", () => {
  it("destroys the connection when the upstream stream fails mid-response", async () => {
    let reads = 0;
    const reader = {
      read: vi.fn(async () => {
        reads += 1;
        if (reads === 1)
          return { done: false, value: new Uint8Array([1, 2, 3]) };
        throw new Error("terminated");
      }),
    };
    const authenticatedFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: { forEach: () => {} },
      body: { getReader: () => reader },
    });
    const service = createService(authenticatedFetch);
    const res = createMockResponse();

    await (
      service as unknown as {
        forwardRequest: (
          url: string,
          options: RequestInit,
          res: http.ServerResponse,
        ) => Promise<void>;
      }
    ).forwardRequest("https://gateway.example/v1/messages", {}, res);

    // Mid-stream failure (headers already sent) must abort the connection so
    // the client sees a truncated/errored response, not a clean end-of-stream.
    expect(res.destroy).toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it("returns a 502 when the upstream fails before any response is sent", async () => {
    const authenticatedFetch = vi
      .fn()
      .mockRejectedValue(new Error("fetch failed"));
    const service = createService(authenticatedFetch);
    const res = createMockResponse();

    await (
      service as unknown as {
        forwardRequest: (
          url: string,
          options: RequestInit,
          res: http.ServerResponse,
        ) => Promise<void>;
      }
    ).forwardRequest("https://gateway.example/v1/messages", {}, res);

    expect(res.writeHead).toHaveBeenCalledWith(502);
    expect(res.end).toHaveBeenCalled();
    expect(res.destroy).not.toHaveBeenCalled();
  });
});
