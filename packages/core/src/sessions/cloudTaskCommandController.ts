export interface CloudTaskCommandTarget {
  taskId: string;
  taskRunId: string;
}

export type CloudTaskCommandMethod =
  | "user_message"
  | "permission_response"
  | "cancel"
  | "set_config_option";

export interface CloudTaskPermissionResponseCommand {
  requestId: string;
  optionId: string;
  answers?: Record<string, string>;
  customInput?: string;
}

export interface CloudTaskCommandTransport<
  CommandResult = unknown,
  StopResult = unknown,
> {
  sendCommand(
    target: CloudTaskCommandTarget,
    method: CloudTaskCommandMethod,
    params?: Record<string, unknown>,
  ): Promise<CommandResult>;
  stopRun(target: CloudTaskCommandTarget): Promise<StopResult>;
}

export class CloudTaskCommandController<
  CommandResult = unknown,
  StopResult = unknown,
> {
  constructor(
    private readonly transport: CloudTaskCommandTransport<
      CommandResult,
      StopResult
    >,
  ) {}

  sendUserMessage(
    target: CloudTaskCommandTarget,
    command: string | Record<string, unknown>,
  ): Promise<CommandResult> {
    return this.transport.sendCommand(
      target,
      "user_message",
      typeof command === "string" ? { content: command } : command,
    );
  }

  respondToPermission(
    target: CloudTaskCommandTarget,
    response: CloudTaskPermissionResponseCommand,
  ): Promise<CommandResult> {
    return this.transport.sendCommand(target, "permission_response", {
      ...response,
    });
  }

  cancelPrompt(target: CloudTaskCommandTarget): Promise<CommandResult> {
    return this.transport.sendCommand(target, "cancel");
  }

  setConfigOption(
    target: CloudTaskCommandTarget,
    configId: string,
    value: string,
  ): Promise<CommandResult> {
    return this.transport.sendCommand(target, "set_config_option", {
      configId,
      value,
    });
  }

  stopRun(target: CloudTaskCommandTarget): Promise<StopResult> {
    return this.transport.stopRun(target);
  }
}
