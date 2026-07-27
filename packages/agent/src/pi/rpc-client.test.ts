import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createPiRpcClient, getPiRpcClientProcess } from "./rpc-client";

describe("createPiRpcClient", () => {
  it("does not put provider credentials in the child environment", () => {
    const client = createPiRpcClient({
      cwd: "/workspace",
      model: "claude-opus-4-8",
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

  it("uses the private host channel without changing Pi RPC", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi-host-channel-"));
    const hostPath = join(directory, "host.mjs");
    await writeFile(
      hostPath,
      `
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
      getPiRpcClientProcess(client)?.kill();
      await rm(directory, { recursive: true });
    }
  });
});
