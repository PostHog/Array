import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

const buildLocalToolsServer = vi.hoisted(() => vi.fn());

vi.mock("../adapters/local-tools/mcp-server-config", () => ({
  buildLocalToolsServer,
}));

import { createPiRpcClient } from "./rpc-client";

describe("createPiRpcClient", () => {
  it("does not put provider credentials in the child environment", () => {
    const client = createPiRpcClient({
      cwd: "/workspace",
      model: "claude-opus-4-8",
      capabilities: { environment: "local" },
      providerOptions: {
        region: "us",
        baseUrl: "http://127.0.0.1:1234",
        apiKey: "proxy-key",
      },
    });

    expect(client).toBeInstanceOf(RpcClient);
    expect(client).toMatchObject({
      options: {
        cwd: "/workspace",
        model: "claude-opus-4-8",
        provider: "posthog",
      },
    });
    expect(
      (client as unknown as { options: { env?: Record<string, string> } })
        .options.env,
    ).toBeUndefined();
  });

  it("runs the RPC host with Electron's Node mode enabled", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-electron-node-mode-"));
    const hostPath = join(directory, "host.mjs");
    const capturePath = join(directory, "capture.txt");
    await writeFile(
      hostPath,
      `
import { closeSync, writeFileSync } from "node:fs";

closeSync(3);
writeFileSync(${JSON.stringify(capturePath)}, process.env.ELECTRON_RUN_AS_NODE ?? "");
process.stdin.resume();
`,
    );
    const client = createPiRpcClient({
      cliPath: hostPath,
      cwd: directory,
      capabilities: { environment: "local" },
      providerOptions: { apiKey: "proxy-key" },
    });

    try {
      await client.start();
      await vi.waitFor(async () => {
        await expect(readFile(capturePath, "utf8")).resolves.toBe("1");
      });
    } finally {
      await client.stop();
      await rm(directory, { recursive: true });
    }
  });

  it("passes local MCP configuration through the private bootstrap pipe", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-local-mcp-bootstrap-"));
    const hostPath = join(directory, "host.mjs");
    const capturePath = join(directory, "capture.json");
    await writeFile(
      hostPath,
      `
import { readFileSync, writeFileSync } from "node:fs";

const bootstrap = JSON.parse(readFileSync(3, "utf8"));
writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify(bootstrap));
process.stdin.resume();
`,
    );
    buildLocalToolsServer.mockReturnValueOnce({
      name: "posthog-code-tools",
      command: "node",
      args: ["local-tools.js"],
      env: [{ name: "POSTHOG_LOCAL_TOOLS_ENABLED", value: "upload_artifact" }],
    });
    const client = createPiRpcClient({
      cliPath: hostPath,
      cwd: directory,
      capabilities: {
        environment: "cloud",
        taskId: "task-1",
        taskRunId: "run-1",
      },
      providerOptions: { apiKey: "proxy-key" },
    });

    try {
      await client.start();
      await vi.waitFor(async () => {
        await expect(readFile(capturePath, "utf8")).resolves.not.toBe("");
      });
      await expect(readFile(capturePath, "utf8")).resolves.toContain(
        '"name":"posthog-code-tools"',
      );
    } finally {
      await client.stop();
      await rm(directory, { recursive: true });
    }
  });

  it("uses the private host channel without changing Pi RPC", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-host-channel-"));
    const hostPath = join(directory, "host.mjs");
    await writeFile(
      hostPath,
      `
import { closeSync } from "node:fs";

closeSync(3);
process.stdin.resume();
process.on("message", (request) => {
  const data = request.method === "clear_queue"
    ? { steering: ["cleared"], followUp: [] }
    : { steering: ["queued"], followUp: ["later"] };
  process.send({ type: "posthog_pi_host_response", id: request.id, data });
});
`,
    );
    const client = createPiRpcClient({
      cliPath: hostPath,
      cwd: directory,
      capabilities: { environment: "local" },
      providerOptions: { apiKey: "proxy-key" },
    });

    try {
      await client.start();

      await expect(client.getQueue()).resolves.toEqual({
        steering: ["queued"],
        followUp: ["later"],
      });
      await expect(client.clearQueue()).resolves.toEqual({
        steering: ["cleared"],
        followUp: [],
      });
    } finally {
      await client.stop();
      await rm(directory, { recursive: true });
    }
  });
});
