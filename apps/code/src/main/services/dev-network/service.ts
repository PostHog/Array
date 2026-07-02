import { injectable } from "inversify";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "@posthog/shared";
import {
  DevNetworkEvent,
  type DevNetworkEvents,
  type NetworkRequest,
  type NetworkSim,
} from "./schemas";

const log = logger.scope("dev-network");

const RING_BUFFER_SIZE = 500;

@injectable()
export class DevNetworkService extends TypedEventEmitter<DevNetworkEvents> {
  private requests: NetworkRequest[] = [];
  private nextId = 1;
  private sim: NetworkSim = { offline: false, slowDelayMs: 0 };
  private installed = false;

  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.wrapFetch();
    log.info("Network instrumentation installed");
  }

  getSnapshot(): NetworkRequest[] {
    return [...this.requests];
  }

  clear(): void {
    this.requests = [];
  }

  getSim(): NetworkSim {
    return { ...this.sim };
  }

  setSim(next: Partial<NetworkSim>): NetworkSim {
    this.sim = { ...this.sim, ...next };
    this.emit(DevNetworkEvent.SimChanged, { ...this.sim });
    return { ...this.sim };
  }

  private record(req: NetworkRequest): void {
    this.requests.push(req);
    if (this.requests.length > RING_BUFFER_SIZE) {
      this.requests.splice(0, this.requests.length - RING_BUFFER_SIZE);
    }
    this.emit(DevNetworkEvent.Request, req);
  }

  private wrapFetch(): void {
    const original = globalThis.fetch;
    if (!original) return;

    const wrapped = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      const startedAt = Date.now();
      const start = performance.now();
      const method = (init?.method ?? "GET").toUpperCase();
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const host = safeHost(url);
      const id = this.nextId++;

      if (this.sim.offline) {
        const err = new TypeError("Network simulated offline");
        this.record({
          id,
          method,
          url,
          host,
          origin: "main",
          status: null,
          ok: false,
          durationMs: performance.now() - start,
          startedAt,
          bytes: null,
          error: err.message,
        });
        throw err;
      }

      if (this.sim.slowDelayMs > 0) {
        await sleep(this.sim.slowDelayMs);
      }

      try {
        const response = await original(input, init);
        const durationMs = performance.now() - start;
        const bytes = parseContentLength(
          response.headers.get("content-length"),
        );
        this.record({
          id,
          method,
          url,
          host,
          origin: "main",
          status: response.status,
          ok: response.ok,
          durationMs,
          startedAt,
          bytes,
        });
        return response;
      } catch (error) {
        const durationMs = performance.now() - start;
        const message = error instanceof Error ? error.message : String(error);
        this.record({
          id,
          method,
          url,
          host,
          origin: "main",
          status: null,
          ok: false,
          durationMs,
          startedAt,
          bytes: null,
          error: message,
        });
        throw error;
      }
    };

    Object.defineProperty(wrapped, "preconnect", {
      value: original.preconnect?.bind(original) ?? (() => undefined),
    });

    globalThis.fetch = wrapped as typeof fetch;
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
