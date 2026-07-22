import { RpcClient } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createPiRpcClient } from "./rpc-client";

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
});
