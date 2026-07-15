import type {
  PiResumeInput,
  PiRunInput,
  PiRunner,
} from "@posthog/core/pi-runtime/piRunner";
import { resolveService } from "@posthog/di/container";
import {
  HOST_TRPC_CLIENT,
  type HostTrpcClient,
} from "@posthog/host-router/client";

function hostClient(): HostTrpcClient {
  return resolveService<HostTrpcClient>(HOST_TRPC_CLIENT);
}

export class TrpcPiRunner implements PiRunner {
  async create(input: PiRunInput): Promise<void> {
    await hostClient().piSession.start.mutate(input);
  }

  resume(input: PiResumeInput): Promise<void> {
    return hostClient().piSession.resume.mutate(input);
  }

  stop(taskId: string): Promise<void> {
    return hostClient().piSession.stop.mutate({ taskId });
  }
}
