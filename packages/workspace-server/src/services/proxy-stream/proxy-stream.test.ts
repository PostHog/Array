import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamBodyToResponse } from "./proxy-stream";

describe("streamBodyToResponse", () => {
  let server: http.Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    server = undefined;
  });

  async function serve(
    handler: (res: http.ServerResponse) => void,
  ): Promise<string> {
    const srv = http.createServer((_req, res) => handler(res));
    server = srv;
    await new Promise<void>((resolve) =>
      srv.listen(0, "127.0.0.1", () => resolve()),
    );
    const addr = srv.address() as { port: number };
    return `http://127.0.0.1:${addr.port}`;
  }

  it("copies the body to the response and ends it", async () => {
    const url = await serve((res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      void streamBodyToResponse(
        new Response("data: one\n\ndata: two\n\n").body,
        res,
      );
    });

    const res = await fetch(url);

    expect(await res.text()).toBe("data: one\n\ndata: two\n\n");
  });

  it("ends the response when the body is null", async () => {
    const url = await serve((res) => {
      res.writeHead(200);
      void streamBodyToResponse(null, res);
    });

    const res = await fetch(url);

    expect(await res.text()).toBe("");
  });

  it("cancels the upstream body when the client disconnects", async () => {
    let cancelled = false;
    const url = await serve((res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("data: one\n\n"));
          // Never closes — simulates an in-flight upstream stream.
        },
        cancel() {
          cancelled = true;
        },
      });
      void streamBodyToResponse(body, res);
    });

    const clientAbort = new AbortController();
    const res = await fetch(url, { signal: clientAbort.signal });
    await res.body?.getReader().read();
    clientAbort.abort();

    await vi.waitFor(() => {
      expect(cancelled).toBe(true);
    });
  });
});
