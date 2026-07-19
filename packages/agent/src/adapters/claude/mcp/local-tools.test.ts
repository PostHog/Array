import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalToolsMcpServer } from "./local-tools";

describe("createLocalToolsMcpServer", () => {
  const savedSandbox = process.env.IS_SANDBOX;

  beforeEach(() => {
    // isCloudRun also keys off IS_SANDBOX; clear it so the meta arg is the only
    // cloud signal under test.
    delete process.env.IS_SANDBOX;
  });

  afterEach(() => {
    if (savedSandbox === undefined) {
      delete process.env.IS_SANDBOX;
    } else {
      process.env.IS_SANDBOX = savedSandbox;
    }
  });

  it("exposes speak on a desktop run with narration on (no cloud-only tools)", async () => {
    const server = createLocalToolsMcpServer(
      { cwd: "/repo", token: "ghs_x" },
      { environment: "local", spokenNarration: true },
    );
    if (!server) {
      throw new Error("expected the local-tools server to be registered");
    }

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("speak");
    // Signed-git tools are cloud-only and must not leak into a desktop run.
    expect(names).not.toContain("git_signed_commit");

    await client.close();
  });

  it("registers no server on a desktop run with narration off (no tools pass their gate)", () => {
    const server = createLocalToolsMcpServer(
      { cwd: "/repo", token: "ghs_x" },
      undefined,
    );
    expect(server).toBeUndefined();
  });

  it("exposes computer tools for opted-in local macOS sessions", async () => {
    const server = createLocalToolsMcpServer(
      { cwd: "/repo", platform: "darwin" },
      { environment: "local", computerUse: true },
    );
    if (!server) {
      throw new Error("expected the local-tools server to be registered");
    }

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("computer_screenshot");

    await client.close();
  });

  it.each([
    {
      platform: "linux" as const,
      environment: "local" as const,
      enabled: true,
    },
    {
      platform: "darwin" as const,
      environment: "cloud" as const,
      enabled: true,
    },
    {
      platform: "darwin" as const,
      environment: "local" as const,
      enabled: false,
    },
  ])(
    "does not expose computer tools for unsupported context %#",
    async (input) => {
      const server = createLocalToolsMcpServer(
        { cwd: "/repo", platform: input.platform },
        { environment: input.environment, computerUse: input.enabled },
      );

      if (!server) {
        expect(server).toBeUndefined();
        return;
      }

      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await server.instance.connect(serverTransport);
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(clientTransport);

      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).not.toContain(
        "computer_screenshot",
      );

      await client.close();
    },
  );

  it("exposes git_signed_commit over MCP in a cloud run with a token", async () => {
    const server = createLocalToolsMcpServer(
      { cwd: "/repo", token: "ghs_x" },
      { environment: "cloud" },
    );
    if (!server) {
      throw new Error("expected the local-tools server to be registered");
    }
    expect(server.name).toBe("posthog-code-tools");

    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.instance.connect(serverTransport);
    const client = new Client({ name: "test", version: "1.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("git_signed_commit");
    expect(names).toContain("git_signed_merge");
    expect(names).toContain("git_signed_rewrite");
    // The adapter resolves spokenNarration before building the server; without
    // an explicit true here the speak tool stays gated off.
    expect(names).not.toContain("speak");

    await client.close();
  });
});
