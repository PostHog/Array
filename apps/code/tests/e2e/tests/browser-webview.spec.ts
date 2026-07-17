import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "../fixtures/electron";

test("browser webview upgrades, navigates, blocks unsafe URLs, and recovers", async ({
  window,
}) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<title>Browser E2E</title><main>Browser works</main>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}`;

  try {
    await window.evaluate(async () => {
      const bridge = (
        window as unknown as {
          electronTRPC: {
            onMessage(callback: (message: unknown) => void): void;
            sendMessage(message: unknown): void;
          };
        }
      ).electronTRPC;
      const id = `browser-e2e-${crypto.randomUUID()}`;
      await new Promise<void>((resolve, reject) => {
        bridge.onMessage((message) => {
          const response = message as {
            id?: string;
            error?: { message?: string };
            result?: { type: string };
          };
          if (response.id !== id) return;
          if (response.error) {
            reject(
              new Error(response.error.message ?? "Failed to enable webview"),
            );
            return;
          }
          resolve();
        });
        bridge.sendMessage({
          method: "request",
          operation: {
            context: {},
            id,
            input: { enabled: true },
            path: "browserView.setEnabled",
            type: "mutation",
          },
        });
      });
    });

    const result = await window.evaluate(async (targetUrl) => {
      type TestWebview = HTMLElement & {
        getURL(): string;
        loadURL(url: string): Promise<void>;
        reload(): void;
      };
      const webview = document.createElement("webview") as TestWebview;
      webview.setAttribute("partition", "persist:browser");
      webview.setAttribute("src", "about:blank");
      webview.style.width = "400px";
      webview.style.height = "300px";
      document.body.appendChild(webview);

      await new Promise<void>((resolve, reject) => {
        const timeout = globalThis.setTimeout(
          () => reject(new Error("Timed out waiting for dom-ready")),
          10_000,
        );
        webview.addEventListener(
          "dom-ready",
          () => {
            globalThis.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
      });

      const upgraded =
        typeof webview.loadURL === "function" &&
        typeof webview.getURL === "function";
      await webview.loadURL(targetUrl);
      const navigatedUrl = webview.getURL();

      let unsafeRejected = false;
      try {
        await webview.loadURL("file:///etc/passwd");
      } catch {
        unsafeRejected = true;
      }

      const reloaded = new Promise<void>((resolve) => {
        webview.addEventListener("did-stop-loading", () => resolve(), {
          once: true,
        });
      });
      webview.reload();
      await reloaded;

      return {
        navigatedUrl,
        recoveredUrl: webview.getURL(),
        unsafeRejected,
        upgraded,
      };
    }, url);

    expect(result.upgraded).toBe(true);
    expect(result.navigatedUrl).toBe(`${url}/`);
    expect(result.unsafeRejected).toBe(true);
    expect(result.recoveredUrl).toBe(`${url}/`);
  } finally {
    server.close();
  }
});
