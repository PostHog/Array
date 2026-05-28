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

  it("returns undefined when no tool's gate passes (desktop run)", () => {
    expect(
      createLocalToolsMcpServer({ cwd: "/repo", token: "ghs_x" }, undefined),
    ).toBeUndefined();
  });

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
    expect(tools.map((t) => t.name)).toContain("git_signed_commit");

    await client.close();
  });
});
