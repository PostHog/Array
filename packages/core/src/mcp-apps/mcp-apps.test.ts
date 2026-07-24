import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpAppsService } from "./mcp-apps";
import type { McpServerConnectionConfig } from "./schemas";

function makeLogger() {
  const scopedLog = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  return { ...scopedLog, scope: vi.fn(() => scopedLog) };
}

function makeService(): McpAppsService {
  const urlLauncher = { launch: vi.fn() };
  return new McpAppsService(urlLauncher as never, makeLogger() as never);
}

describe("McpAppsService.getUiResourceByUri", () => {
  let service: McpAppsService;

  beforeEach(() => {
    service = makeService();
  });

  it("rejects non-ui:// URIs without attempting a fetch", async () => {
    await expect(
      service.getUiResourceByUri("posthog", "https://evil.example/app.html"),
    ).resolves.toBeNull();
    await expect(
      service.getUiResourceByUri("posthog", "file:///etc/passwd"),
    ).resolves.toBeNull();
  });

  it("rejects when the server has no connection config", async () => {
    await expect(
      service.getUiResourceByUri("posthog", "ui://posthog/survey-list.html"),
    ).rejects.toThrow("No server config for: posthog");
  });
});

type ConnectionInternals = {
  getOrCreateConnection(serverName: string): Promise<unknown>;
  createConnection(config: McpServerConnectionConfig): Promise<unknown>;
};

function internals(service: McpAppsService): ConnectionInternals {
  return service as unknown as ConnectionInternals;
}

function config(name: string): McpServerConnectionConfig {
  return { name, url: `https://example.test/${name}/mcp`, headers: {} };
}

describe("McpAppsService config resolver", () => {
  let service: McpAppsService;

  beforeEach(() => {
    service = makeService();
  });

  it("connects after the resolver supplies the missing config", async () => {
    service.setConfigResolver(async (name) => {
      service.addServerConfigs([config(name)]);
    });
    const createConnection = vi
      .spyOn(internals(service), "createConnection")
      .mockImplementation(async (c) => ({ name: c.name }));

    await expect(
      internals(service).getOrCreateConnection("posthog"),
    ).resolves.toEqual({ name: "posthog" });
    expect(createConnection).toHaveBeenCalledWith(config("posthog"));
  });

  it("still throws when the resolver leaves the config missing", async () => {
    const resolver = vi.fn(async () => {});
    service.setConfigResolver(resolver);

    await expect(
      internals(service).getOrCreateConnection("posthog"),
    ).rejects.toThrow("No server config for: posthog");
    expect(resolver).toHaveBeenCalledWith("posthog");
  });

  it("dedupes concurrent callers waiting on the resolver", async () => {
    const resolver = vi.fn(async (name: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      service.addServerConfigs([config(name)]);
    });
    service.setConfigResolver(resolver);
    const createConnection = vi
      .spyOn(internals(service), "createConnection")
      .mockImplementation(async (c) => ({ name: c.name }));

    const [first, second] = await Promise.all([
      internals(service).getOrCreateConnection("posthog"),
      internals(service).getOrCreateConnection("posthog"),
    ]);

    expect(first).toBe(second);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(createConnection).toHaveBeenCalledTimes(1);
  });

  it("addServerConfigs merges without clearing existing configs", async () => {
    service.setServerConfigs([config("posthog")]);
    service.addServerConfigs([config("installation")]);
    const createConnection = vi
      .spyOn(internals(service), "createConnection")
      .mockImplementation(async (c) => ({ name: c.name }));

    await internals(service).getOrCreateConnection("posthog");
    await internals(service).getOrCreateConnection("installation");
    expect(createConnection).toHaveBeenCalledTimes(2);
  });
});

const UI_MIME_TYPE = "text/html;profile=mcp-app";

describe("McpAppsService resource cache isolation", () => {
  let service: McpAppsService;

  beforeEach(() => {
    service = makeService();
  });

  function stubPerServerReads(): void {
    vi.spyOn(internals(service), "getOrCreateConnection").mockImplementation(
      async (serverName: string) => ({
        name: serverName,
        client: {
          readResource: async () => ({
            contents: [
              {
                text: `<html>${serverName}</html>`,
                mimeType: UI_MIME_TYPE,
              },
            ],
          }),
        },
      }),
    );
  }

  it("does not let one server's resource satisfy another's fetch for the same URI", async () => {
    stubPerServerReads();
    const uri = "ui://posthog/survey-list.html";

    const trusted = await service.getUiResourceByUri("posthog", uri);
    const malicious = await service.getUiResourceByUri("evil", uri);

    expect(trusted?.html).toBe("<html>posthog</html>");
    expect(trusted?.serverName).toBe("posthog");
    expect(malicious?.html).toBe("<html>evil</html>");
    expect(malicious?.serverName).toBe("evil");
  });

  it("serves a cache hit only to the server that populated it", async () => {
    const getConn = vi
      .spyOn(internals(service), "getOrCreateConnection")
      .mockImplementation(async (serverName: string) => ({
        name: serverName,
        client: {
          readResource: async () => ({
            contents: [
              { text: `<html>${serverName}</html>`, mimeType: UI_MIME_TYPE },
            ],
          }),
        },
      }));
    const uri = "ui://posthog/survey-list.html";

    await service.getUiResourceByUri("posthog", uri);
    await service.getUiResourceByUri("posthog", uri);
    const other = await service.getUiResourceByUri("evil", uri);

    expect(getConn).toHaveBeenCalledTimes(2);
    expect(other?.serverName).toBe("evil");
  });

  it("does not share an in-flight fetch across servers for the same URI", async () => {
    const reads: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(internals(service), "getOrCreateConnection").mockImplementation(
      async (serverName: string) => ({
        name: serverName,
        client: {
          readResource: async () => {
            reads.push(serverName);
            await gate;
            return {
              contents: [
                { text: `<html>${serverName}</html>`, mimeType: UI_MIME_TYPE },
              ],
            };
          },
        },
      }),
    );
    const uri = "ui://shared/app.html";

    const first = service.getUiResourceByUri("posthog", uri);
    const other = service.getUiResourceByUri("evil", uri);
    const joined = service.getUiResourceByUri("posthog", uri);
    release();
    const [r1, r2, r3] = await Promise.all([first, other, joined]);

    expect(reads.filter((s) => s === "posthog")).toHaveLength(1);
    expect(reads.filter((s) => s === "evil")).toHaveLength(1);
    expect(r1?.serverName).toBe("posthog");
    expect(r3?.serverName).toBe("posthog");
    expect(r2?.serverName).toBe("evil");
  });
});

describe("McpAppsService.proxyToolCall authorization", () => {
  let service: McpAppsService;
  const callTool = vi.fn(async () => ({ ok: true }));

  function discoverTools(tools: unknown[]): Promise<void> {
    vi.spyOn(internals(service), "getOrCreateConnection").mockResolvedValue({
      name: "posthog",
      client: {
        listTools: async () => ({ tools }),
        listResources: async () => ({ resources: [] }),
        callTool,
      },
    });
    service.setServerConfigs([config("posthog")]);
    return service.handleDiscovery(["posthog"]);
  }

  beforeEach(() => {
    service = makeService();
    callTool.mockClear();
  });

  it("denies a tool that declares no UI metadata", async () => {
    await discoverTools([{ name: "exec" }]);

    await expect(service.proxyToolCall("posthog", "exec")).rejects.toThrow(
      'Tool "exec" is not exposed to apps',
    );
    expect(callTool).not.toHaveBeenCalled();
  });

  it("denies a tool that was never discovered", async () => {
    await discoverTools([]);

    await expect(
      service.proxyToolCall("posthog", "delete_all"),
    ).rejects.toThrow('Tool "delete_all" is not exposed to apps');
    expect(callTool).not.toHaveBeenCalled();
  });

  it("allows a tool that opts in with ui.visibility app", async () => {
    await discoverTools([
      { name: "search", _meta: { ui: { visibility: ["app"] } } },
    ]);

    await expect(service.proxyToolCall("posthog", "search")).resolves.toEqual({
      ok: true,
    });
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("allows a tool that carries a UI association", async () => {
    await discoverTools([
      {
        name: "surveys",
        _meta: { ui: { resourceUri: "ui://posthog/s.html" } },
      },
    ]);

    await expect(service.proxyToolCall("posthog", "surveys")).resolves.toEqual({
      ok: true,
    });
  });

  it("still rejects a model-only tool", async () => {
    await discoverTools([
      {
        name: "surveys",
        _meta: {
          ui: { resourceUri: "ui://posthog/s.html", visibility: ["model"] },
        },
      },
    ]);

    await expect(service.proxyToolCall("posthog", "surveys")).rejects.toThrow(
      "not accessible to apps",
    );
    expect(callTool).not.toHaveBeenCalled();
  });
});
