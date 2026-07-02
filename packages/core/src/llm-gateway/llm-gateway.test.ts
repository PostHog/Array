import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LlmGatewayAuth,
  LlmGatewayEndpoints,
  LlmGatewayHost,
  LlmGatewayLogger,
} from "./identifiers";
import { LlmGatewayError, LlmGatewayService } from "./llm-gateway";

const API_HOST = "https://app.example.com";

function createJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function createService(
  authenticatedFetch: LlmGatewayAuth["authenticatedFetch"],
) {
  const auth: LlmGatewayAuth = {
    getValidAccessToken: vi
      .fn()
      .mockResolvedValue({ accessToken: "tok", apiHost: API_HOST }),
    authenticatedFetch,
  };

  const endpoints: LlmGatewayEndpoints = {
    messagesUrl: (host) => `${host}/gateway/v1/messages`,
    usageUrl: (host) => `${host}/gateway/usage`,
    invalidatePlanCacheUrl: (host) => `${host}/gateway/invalidate`,
    defaultModel: "claude-default",
  };

  const host: LlmGatewayHost = { ...auth, ...endpoints };

  const log: LlmGatewayLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  const logger = { ...log, scope: () => log };

  const service = new LlmGatewayService(host, logger);
  return { service, auth, endpoints, log };
}

const SUCCESS_BODY = {
  id: "msg_1",
  type: "message" as const,
  role: "assistant" as const,
  content: [{ type: "text" as const, text: "hello world" }],
  model: "claude-resolved",
  stop_reason: "end_turn",
  usage: { input_tokens: 12, output_tokens: 7 },
};

describe("LlmGatewayService.prompt", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("returns parsed content, model, and usage on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createJsonResponse(SUCCESS_BODY));
    const { service } = createService(fetchMock);

    const result = await service.prompt([{ role: "user", content: "hi" }]);

    expect(result).toEqual({
      content: "hello world",
      model: "claude-resolved",
      stopReason: "end_turn",
      usage: { inputTokens: 12, outputTokens: 7 },
    });
  });

  it("posts to the resolved messages URL with the default model and request body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createJsonResponse(SUCCESS_BODY));
    const { service } = createService(fetchMock);

    await service.prompt([{ role: "user", content: "hi" }], {
      system: "be terse",
      maxTokens: 256,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_HOST}/gateway/v1/messages`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("claude-default");
    expect(body.system).toBe("be terse");
    expect(body.max_tokens).toBe(256);
    expect(body.stream).toBe(false);
  });

  it("forwards posthogProperties as x-posthog-property-* request headers and skips nulls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createJsonResponse(SUCCESS_BODY));
    const { service } = createService(fetchMock);

    await service.prompt([{ role: "user", content: "hi" }], {
      posthogProperties: {
        $ai_span_name: "pr_description",
        task_id: 42,
        is_dry_run: false,
        // Null/undefined values are dropped so the gateway doesn't see
        // literal "null" strings on the captured event.
        unused: null,
        skipped: undefined,
        // Newlines and non-latin1 bytes are sanitized so an undici-backed
        // fetch doesn't reject the request before it's sent.
        rich: "line one\nline two — done 🎉",
      },
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers).toMatchObject({
      "x-posthog-property-$ai_span_name": "pr_description",
      "x-posthog-property-task_id": "42",
      "x-posthog-property-is_dry_run": "false",
      "x-posthog-property-rich": "line one line two  done ",
    });
    expect(init.headers).not.toHaveProperty("x-posthog-property-unused");
    expect(init.headers).not.toHaveProperty("x-posthog-property-skipped");
  });

  it("throws a typed LlmGatewayError with parsed error fields on non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse(
        {
          error: {
            message: "rate limited",
            type: "rate_limit",
            code: "slow_down",
          },
        },
        429,
      ),
    );
    const { service } = createService(fetchMock);

    await expect(
      service.prompt([{ role: "user", content: "hi" }]),
    ).rejects.toMatchObject({
      name: "LlmGatewayError",
      message: "rate limited",
      type: "rate_limit",
      code: "slow_down",
      statusCode: 429,
    });
  });

  it("throws a timeout LlmGatewayError when the request aborts via the internal timeout", async () => {
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const { service } = createService(fetchMock as never);

    const promise = service.prompt([{ role: "user", content: "hi" }], {
      timeoutMs: 5,
    });

    await expect(promise).rejects.toBeInstanceOf(LlmGatewayError);
    await expect(promise).rejects.toMatchObject({ type: "timeout" });
  });
});

describe("LlmGatewayService.fetchUsage", () => {
  const USAGE_BODY = {
    product: "code",
    user_id: 1,
    sustained: {
      used_percent: 10,
      reset_at: "2026-01-01T00:00:00.000Z",
      exceeded: false,
    },
    burst: {
      used_percent: 20,
      reset_at: "2026-01-01T00:00:00.000Z",
      exceeded: false,
    },
    is_rate_limited: false,
    is_pro: true,
  };

  it("returns the schema-parsed usage payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(USAGE_BODY));
    const { service } = createService(fetchMock);

    const usage = await service.fetchUsage();

    expect(usage.product).toBe("code");
    expect(usage.is_pro).toBe(true);
    expect(usage.sustained.used_percent).toBe(10);
  });

  it("throws a usage_error LlmGatewayError on non-ok response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({}, 503));
    const { service } = createService(fetchMock);

    await expect(service.fetchUsage()).rejects.toMatchObject({
      type: "usage_error",
      statusCode: 503,
    });
  });
});

describe("LlmGatewayService.invalidatePlanCache", () => {
  it("POSTs to the invalidate URL and resolves on success", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const { service } = createService(fetchMock);

    await expect(service.invalidatePlanCache()).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${API_HOST}/gateway/invalidate`);
    expect(init.method).toBe("POST");
  });

  it("throws a plan_cache_error LlmGatewayError on non-ok response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 500 }));
    const { service } = createService(fetchMock);

    await expect(service.invalidatePlanCache()).rejects.toMatchObject({
      type: "plan_cache_error",
      statusCode: 500,
    });
  });
});
