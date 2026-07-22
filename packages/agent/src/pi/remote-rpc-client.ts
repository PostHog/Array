import type {
  RpcClient,
  RpcCommand,
  RpcResponse,
} from "@earendil-works/pi-coding-agent";
import type { AgentConversationEvent } from "@posthog/shared";
import { createPiConversationTranslator } from "./conversation/translatePiConversation";
import { type PiRpcTransport, parsePiRpcResponse } from "./rpc-transport";

export type PiRemoteRpcClient = Pick<
  RpcClient,
  | "prompt"
  | "steer"
  | "followUp"
  | "abort"
  | "getState"
  | "setModel"
  | "getAvailableModels"
  | "getAvailableThinkingLevels"
  | "setThinkingLevel"
  | "setSteeringMode"
  | "setFollowUpMode"
  | "compact"
  | "bash"
  | "abortBash"
  | "getEntries"
  | "getCommands"
>;

export async function getRemotePiConversation(
  client: Pick<PiRemoteRpcClient, "getEntries">,
): Promise<AgentConversationEvent[]> {
  const entries = await client.getEntries();
  const translator = createPiConversationTranslator();
  const events: AgentConversationEvent[] = [];

  for (const entry of entries.entries) {
    if (entry.type === "message") {
      events.push(...translator.translateHistoryMessage(entry.message));
    }
  }

  return events;
}

export class RemotePiRpcClient implements PiRemoteRpcClient {
  constructor(private readonly transport: PiRpcTransport) {}

  async prompt(
    message: string,
    images?: Parameters<PiRemoteRpcClient["prompt"]>[1],
  ): Promise<void> {
    await this.request({ type: "prompt", message, images });
  }

  async steer(
    message: string,
    images?: Parameters<PiRemoteRpcClient["steer"]>[1],
  ): Promise<void> {
    await this.request({ type: "steer", message, images });
  }

  async followUp(
    message: string,
    images?: Parameters<PiRemoteRpcClient["followUp"]>[1],
  ): Promise<void> {
    await this.request({ type: "follow_up", message, images });
  }

  async abort(): Promise<void> {
    await this.request({ type: "abort" });
  }

  async getState(): ReturnType<PiRemoteRpcClient["getState"]> {
    return this.data(await this.request({ type: "get_state" }));
  }

  async setModel(
    provider: string,
    modelId: string,
  ): ReturnType<PiRemoteRpcClient["setModel"]> {
    return this.data(
      await this.request({ type: "set_model", provider, modelId }),
    );
  }

  async getAvailableModels(): ReturnType<
    PiRemoteRpcClient["getAvailableModels"]
  > {
    const data = this.data<{
      models: Awaited<ReturnType<PiRemoteRpcClient["getAvailableModels"]>>;
    }>(await this.request({ type: "get_available_models" }));
    return data.models;
  }

  async getAvailableThinkingLevels(): ReturnType<
    PiRemoteRpcClient["getAvailableThinkingLevels"]
  > {
    const data = this.data<{
      levels: Awaited<
        ReturnType<PiRemoteRpcClient["getAvailableThinkingLevels"]>
      >;
    }>(await this.request({ type: "get_available_thinking_levels" }));
    return data.levels;
  }

  async setThinkingLevel(
    level: Parameters<PiRemoteRpcClient["setThinkingLevel"]>[0],
  ): Promise<void> {
    await this.request({ type: "set_thinking_level", level });
  }

  async setSteeringMode(
    mode: Parameters<PiRemoteRpcClient["setSteeringMode"]>[0],
  ): Promise<void> {
    await this.request({ type: "set_steering_mode", mode });
  }

  async setFollowUpMode(
    mode: Parameters<PiRemoteRpcClient["setFollowUpMode"]>[0],
  ): Promise<void> {
    await this.request({ type: "set_follow_up_mode", mode });
  }

  async compact(
    customInstructions?: string,
  ): ReturnType<PiRemoteRpcClient["compact"]> {
    return this.data(
      await this.request({ type: "compact", customInstructions }),
    );
  }

  async bash(command: string): ReturnType<PiRemoteRpcClient["bash"]> {
    return this.data(await this.request({ type: "bash", command }));
  }

  async abortBash(): Promise<void> {
    await this.request({ type: "abort_bash" });
  }

  async getEntries(
    since?: string,
  ): ReturnType<PiRemoteRpcClient["getEntries"]> {
    return this.data(await this.request({ type: "get_entries", since }));
  }

  async getCommands(): ReturnType<PiRemoteRpcClient["getCommands"]> {
    const data = this.data<{
      commands: Awaited<ReturnType<PiRemoteRpcClient["getCommands"]>>;
    }>(await this.request({ type: "get_commands" }));
    return data.commands;
  }

  private async request(command: RpcCommand): Promise<RpcResponse> {
    return parsePiRpcResponse(await this.transport.request(command));
  }

  private data<T>(response: RpcResponse): T {
    if (!response.success) {
      throw new Error(response.error);
    }
    return (response as unknown as { data: T }).data;
  }
}
