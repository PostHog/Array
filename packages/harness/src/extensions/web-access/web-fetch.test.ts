import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWebFetchTool,
  isPermittedRedirect,
  makeSummarizationPrompt,
  validateUrl,
} from "./web-fetch";

describe("validateUrl", () => {
  it.each([
    ["https://example.com/page", true],
    ["http://example.com", true],
    [
      `https://example.com/${"a".repeat(2000 - "https://example.com/".length)}`,
      true,
    ],
  ])("accepts %s", (url, expected) => {
    expect(validateUrl(url).valid).toBe(expected);
  });

  it.each([
    [`https://example.com/${"a".repeat(2000)}`, "maximum length"],
    ["not a url", "Invalid URL"],
    ["https://user@example.com/page", "credentials"],
    ["https://user:pass@example.com/page", "credentials"],
    ["https://localhost/page", "public hostname"],
  ])("rejects %s with reason containing '%s'", (url, reason) => {
    const result = validateUrl(url);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toContain(reason);
  });

  it("boundary: accepts at exactly 2000 chars, rejects at 2001", () => {
    const base = "https://example.com/";
    const atLimit = `${base}${"a".repeat(2000 - base.length)}`;
    const overLimit = `${base}${"a".repeat(2001 - base.length)}`;
    expect(atLimit.length).toBe(2000);
    expect(overLimit.length).toBe(2001);
    expect(validateUrl(atLimit).valid).toBe(true);
    expect(validateUrl(overLimit).valid).toBe(false);
  });
});

describe("isPermittedRedirect", () => {
  it.each([
    [
      "same host, path change",
      "https://example.com/a",
      "https://example.com/b",
      true,
    ],
    ["adding www", "https://example.com/p", "https://www.example.com/p", true],
    [
      "removing www",
      "https://www.example.com/p",
      "https://example.com/p",
      true,
    ],
    ["cross-host", "https://example.com/p", "https://evil.com/p", false],
    ["protocol change", "https://example.com/p", "http://example.com/p", false],
    [
      "port change",
      "https://example.com/p",
      "https://example.com:8080/p",
      false,
    ],
    [
      "credentials injected",
      "https://example.com/p",
      "https://user:pass@example.com/p",
      false,
    ],
    [
      "subdomain beyond www",
      "https://example.com/p",
      "https://api.example.com/p",
      false,
    ],
    ["invalid URLs", "not a url", "also not a url", false],
  ])("%s → %s", (_label, from, to, expected) => {
    expect(isPermittedRedirect(from, to)).toBe(expected);
  });
});

describe("makeSummarizationPrompt", () => {
  it("includes content and prompt in output", () => {
    const result = makeSummarizationPrompt("# Hello World", "Summarize this");
    expect(result).toContain("# Hello World");
    expect(result).toContain("Summarize this");
    expect(result).toContain("Web page content:");
  });

  it("truncates content exceeding 100K chars", () => {
    const result = makeSummarizationPrompt("x".repeat(150_000), "Summarize");
    expect(result).toContain("[Content truncated due to length...]");
    expect(result.split("---")[1]?.length).toBeLessThan(110_000);
  });

  it("does not truncate content under 100K chars", () => {
    const content = "x".repeat(50_000);
    const result = makeSummarizationPrompt(content, "Summarize");
    expect(result).not.toContain("[Content truncated");
    expect(result).toContain(content);
  });

  it("handles empty content", () => {
    const result = makeSummarizationPrompt("", "Extract the title");
    expect(result).toContain("Extract the title");
    expect(result).toContain("---\n\n---");
  });
});

function fakeCtx(apiKey: string | undefined): ExtensionContext {
  return {
    modelRegistry: {
      getApiKeyForProvider: vi.fn().mockResolvedValue(apiKey),
    },
  } as unknown as ExtensionContext;
}

describe("createWebFetchTool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("rejects invalid URLs before attempting a fetch", async () => {
    const tool = createWebFetchTool({ region: "us", apiKey: "pha_test" });
    await expect(
      tool.execute(
        "call-1",
        { url: "not a url", prompt: "summarize" },
        undefined,
        undefined,
        fakeCtx(undefined),
      ),
    ).rejects.toThrow(/Invalid URL/);
  });

  it("returns raw markdown without gateway credentials", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      headers: new Headers({ "content-type": "text/html" }),
      text: async () => "<h1>Hello</h1>",
    }) as unknown as typeof fetch;

    const tool = createWebFetchTool({ region: "us" });
    const result = await tool.execute(
      "call-1",
      { url: "https://example.com/page", prompt: "summarize" },
      undefined,
      undefined,
      fakeCtx(undefined),
    );

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Hello"),
    });
  });

  it("summarizes via the gateway when credentials are available", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/v1/chat/completions")) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: "Summary text" } }],
          }),
        } as unknown as Response;
      }
      return {
        status: 200,
        ok: true,
        headers: new Headers({ "content-type": "text/html" }),
        text: async () => "<p>Some content</p>",
      } as unknown as Response;
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const tool = createWebFetchTool({ region: "us", apiKey: "pha_test" });
    const result = await tool.execute(
      "call-1",
      { url: "https://example.com/other-page", prompt: "extract title" },
      undefined,
      undefined,
      fakeCtx(undefined),
    );

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: "Summary text",
    });
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/v1/chat/completions"),
      ),
    ).toBe(true);
  });

  it("reports cross-host redirects instead of following them", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 302,
      headers: new Headers({ location: "https://evil.com/other" }),
    }) as unknown as typeof fetch;

    const tool = createWebFetchTool({ region: "us" });
    const result = await tool.execute(
      "call-1",
      { url: "https://example.com/redirecting-page", prompt: "x" },
      undefined,
      undefined,
      fakeCtx(undefined),
    );

    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("REDIRECT DETECTED"),
    });
    expect(result.details).toMatchObject({
      redirectUrl: "https://evil.com/other",
    });
  });
});
