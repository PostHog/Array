import type { RpcCommand, RpcResponse } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { RemotePiRpcClient } from "./remote-rpc-client";
import { piRpcCommandSchema } from "./rpc-transport";

function response(command: RpcCommand, data?: unknown): RpcResponse {
  return {
    type: "response" as const,
    command: command.type,
    success: true as const,
    ...(data === undefined ? {} : { data }),
  } as RpcResponse;
}

describe("RemotePiRpcClient", () => {
  it("uses Pi's native methods to encode commands over an injected transport", async () => {
    const request = vi.fn(async (command: RpcCommand) => {
      if (command.type === "compact") {
        return response(command, {
          summary: "summary",
          firstKeptEntryId: "entry-1",
          tokensBefore: 100,
        });
      }
      if (command.type === "get_available_thinking_levels") {
        return response(command, { levels: ["off", "high", "xhigh"] });
      }
      return response(command);
    });
    const client = new RemotePiRpcClient({ request });

    await client.setFollowUpMode("one-at-a-time");
    const compaction = await client.compact("retain decisions");
    const thinkingLevels = await client.getAvailableThinkingLevels();

    expect(request).toHaveBeenNthCalledWith(1, {
      id: expect.any(String),
      type: "set_follow_up_mode",
      mode: "one-at-a-time",
    });
    expect(request).toHaveBeenNthCalledWith(2, {
      id: expect.any(String),
      type: "compact",
      customInstructions: "retain decisions",
    });
    expect(request).toHaveBeenNthCalledWith(3, {
      id: expect.any(String),
      type: "get_available_thinking_levels",
    });
    expect(compaction.summary).toBe("summary");
    expect(thinkingLevels).toEqual(["off", "high", "xhigh"]);
  });

  it("rejects malformed responses from every transport", async () => {
    const client = new RemotePiRpcClient({
      request: vi.fn(async () => ({ type: "not-a-response" })),
    });

    await expect(client.getState()).rejects.toThrow();
  });

  it("requires a native command type at the transport boundary", () => {
    expect(() => piRpcCommandSchema.parse({ mode: "invalid" })).toThrow();
  });
});
