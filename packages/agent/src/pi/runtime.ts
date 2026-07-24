import type {
  AgentSessionEvent,
  RpcCommand,
  RpcResponse,
} from "@earendil-works/pi-coding-agent";
import type { AgentConversationEvent } from "@posthog/shared";
import {
  createPiConversationTranslator,
  type PiConversationTranslator,
  type PiDirectBashResult,
} from "./conversation/translatePiConversation";
import { getPiRpcClientProcess, type PiRpcClient } from "./rpc-client";
import { sendPiRpcCommand } from "./rpc-transport";

export class PiRuntime {
  readonly client: PiRpcClient;

  private readonly translator: PiConversationTranslator;
  private readonly runtimeListeners = new Set<
    (event: AgentSessionEvent) => void
  >();
  private readonly conversationListeners = new Set<
    (event: AgentConversationEvent) => void
  >();

  constructor(client: PiRpcClient) {
    this.client = client;
    this.translator = createPiConversationTranslator();
    client.onEvent((event) => this.handleEvent(event));
  }

  get process() {
    return getPiRpcClientProcess(this.client);
  }

  onRuntimeEvent(listener: (event: AgentSessionEvent) => void): () => void {
    this.runtimeListeners.add(listener);
    return () => this.runtimeListeners.delete(listener);
  }

  onConversationEvent(
    listener: (event: AgentConversationEvent) => void,
  ): () => void {
    this.conversationListeners.add(listener);
    return () => this.conversationListeners.delete(listener);
  }

  async sendCommand(command: RpcCommand): Promise<RpcResponse> {
    if (command.type !== "bash") {
      return sendPiRpcCommand(this.client, command);
    }

    this.emitConversationEvents(
      this.translator.beginDirectBash(command.command),
    );
    try {
      const response = await sendPiRpcCommand(this.client, command);
      if (response.success) {
        const result = (response as { data: PiDirectBashResult }).data;
        this.emitConversationEvents(this.translator.completeDirectBash(result));
      } else {
        this.emitConversationEvents(
          this.translator.failDirectBash(response.error),
        );
      }
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitConversationEvents(this.translator.failDirectBash(message));
      throw error;
    }
  }

  private handleEvent(event: AgentSessionEvent): void {
    for (const listener of this.runtimeListeners) {
      listener(event);
    }

    this.emitConversationEvents(this.translator.translateEvent(event));
  }

  private emitConversationEvents(events: AgentConversationEvent[]): void {
    for (const event of events) {
      for (const listener of this.conversationListeners) {
        listener(event);
      }
    }
  }
}
