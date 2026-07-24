import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMcpServiceImpl } from "./local-mcp";

let home: string;
let originalHome: string | undefined;

function mcpConfigPath(): string {
  return path.join(home, ".posthog-code", "mcp.json");
}

async function writeMcpConfig(data: unknown) {
  await mkdir(path.dirname(mcpConfigPath()), { recursive: true });
  await writeFile(mcpConfigPath(), JSON.stringify(data));
}

beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), "local-mcp-test-"));
  originalHome = process.env.HOME;
  process.env.HOME = home;
});

afterEach(async () => {
  process.env.HOME = originalHome;
  await rm(home, { recursive: true, force: true });
});

describe("LocalMcpServiceImpl.listServers", () => {
  it("returns empty when the config is missing or malformed", async () => {
    const service = new LocalMcpServiceImpl();
    expect(await service.listServers()).toEqual([]);

    await mkdir(path.dirname(mcpConfigPath()), { recursive: true });
    await writeFile(mcpConfigPath(), "not json");
    expect(await service.listServers()).toEqual([]);
  });

  it("normalizes shared HTTP and stdio transports", async () => {
    await writeMcpConfig({
      mcpServers: {
        grafana: {
          type: "http",
          url: "https://grafana.example.com/mcp",
          headers: { Authorization: "Bearer abc" },
        },
        legacy: { type: "sse", url: "https://sse.example.com/mcp" },
        playwright: {
          type: "stdio",
          command: "npx",
          args: ["@playwright/mcp@latest"],
          env: { SECRET: "do-not-leak" },
        },
      },
    });

    const servers = await new LocalMcpServiceImpl().listServers();

    expect(servers).toEqual([
      {
        name: "grafana",
        scope: "user",
        transport: {
          type: "http",
          url: "https://grafana.example.com/mcp",
          headers: { Authorization: "Bearer abc" },
        },
      },
      {
        name: "legacy",
        scope: "user",
        transport: { type: "unknown" },
      },
      {
        name: "playwright",
        scope: "user",
        transport: {
          type: "stdio",
          command: "npx",
          args: ["@playwright/mcp@latest"],
        },
      },
    ]);
  });

  it.each([
    {
      name: "command without type is stdio",
      config: { command: "uvx", args: ["some-mcp"] },
      transport: { type: "stdio", command: "uvx", args: ["some-mcp"] },
    },
    {
      name: "bare url without type is unknown",
      config: { url: "https://bare.example.com/mcp" },
      transport: { type: "unknown" },
    },
    {
      name: "unrecognized shape is unknown",
      config: { type: "websocket", endpoint: "wss://x" },
      transport: { type: "unknown" },
    },
    {
      name: "non-object config is unknown",
      config: null,
      transport: { type: "unknown" },
    },
  ])("$name", async ({ config, transport }) => {
    await writeMcpConfig({ mcpServers: { server: config } });
    const servers = await new LocalMcpServiceImpl().listServers();
    expect(servers).toEqual([{ name: "server", scope: "user", transport }]);
  });
});

describe("LocalMcpServiceImpl.getConfigFile", () => {
  it("returns the local config path and its content when present", async () => {
    await writeMcpConfig({ mcpServers: {} });

    await expect(new LocalMcpServiceImpl().getConfigFile()).resolves.toEqual({
      path: mcpConfigPath(),
      content: JSON.stringify({ mcpServers: {} }),
    });
  });

  it("reports a missing local config without failing", async () => {
    await expect(new LocalMcpServiceImpl().getConfigFile()).resolves.toEqual({
      path: mcpConfigPath(),
      content: null,
    });
  });
});

describe("LocalMcpServiceImpl.updateConfigFile", () => {
  it("saves the exact content, including invalid JSON", async () => {
    const content = "{ invalid json";

    await expect(
      new LocalMcpServiceImpl().updateConfigFile(content),
    ).resolves.toEqual({ path: mcpConfigPath(), content });
    await expect(readFile(mcpConfigPath(), "utf8")).resolves.toBe(content);
  });

  it("serializes concurrent saves so the latest content wins", async () => {
    const service = new LocalMcpServiceImpl();
    await Promise.all([
      service.updateConfigFile("first"),
      service.updateConfigFile("second"),
    ]);

    await expect(readFile(mcpConfigPath(), "utf8")).resolves.toBe("second");
  });

  it.runIf(process.platform !== "win32")(
    "restricts config and directory permissions",
    async () => {
      await new LocalMcpServiceImpl().updateConfigFile("secret");

      const fileMode = (await stat(mcpConfigPath())).mode & 0o777;
      const directoryMode =
        (await stat(path.dirname(mcpConfigPath()))).mode & 0o777;
      expect(fileMode).toBe(0o600);
      expect(directoryMode).toBe(0o700);
    },
  );
});
