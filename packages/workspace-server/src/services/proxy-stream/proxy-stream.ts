import type http from "node:http";

function waitForDrainOrClose(res: http.ServerResponse): Promise<void> {
  return new Promise<void>((resolve) => {
    const settle = () => {
      res.off("drain", settle);
      res.off("close", settle);
      resolve();
    };
    res.once("drain", settle);
    res.once("close", settle);
  });
}

/**
 * Copy a fetch Response body to an http.ServerResponse, respecting
 * backpressure. The caller writes the response head first. A client
 * disconnect cancels the upstream read; upstream errors reject so the
 * caller can handle them alongside its other fetch failures.
 */
export async function streamBodyToResponse(
  body: ReadableStream<Uint8Array> | null,
  res: http.ServerResponse,
): Promise<void> {
  if (!body) {
    res.end();
    return;
  }
  const reader = body.getReader();
  res.on("close", () => {
    void reader.cancel().catch(() => {});
  });
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      res.end();
      return;
    }
    if (!res.write(value)) {
      await waitForDrainOrClose(res);
    }
  }
}
