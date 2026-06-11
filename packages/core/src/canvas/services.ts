import type { ChannelTaskRecord } from "./channelTaskSchemas";
import type { DashboardRecord, DashboardSummary } from "./dashboardSchemas";
import type {
  CanvasGenEventPayload,
  CanvasGenerateInput,
  CanvasThreadInput,
} from "./genSchemas";
import type {
  DashboardQueryResult,
  DashboardQueryRunInput,
} from "./querySchemas";

// Structural service interfaces the host-router routers depend on. The concrete
// implementations live in the desktop app's main process and are bound to the
// tokens in identifiers.ts; the router only needs the method surface.

export interface ICanvasGenService {
  generate(input: CanvasGenerateInput): Promise<void>;
  reset(input: CanvasThreadInput): Promise<void>;
  /** Async iterable of canvas stream events (for the onEvent subscription). */
  toIterable(
    event: "canvas-event",
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<CanvasGenEventPayload>;
}

export interface IDashboardsService {
  list(channelId: string): Promise<DashboardSummary[]>;
  get(id: string): Promise<DashboardRecord | null>;
  create(input: {
    channelId: string;
    name: string;
    spec: Record<string, unknown> | null;
  }): Promise<DashboardRecord>;
  update(input: {
    id: string;
    name?: string;
    spec: Record<string, unknown> | null;
  }): Promise<DashboardRecord>;
  delete(id: string): Promise<void>;
  refresh(input: {
    id: string;
    elementKeys?: string[];
    touchUpdatedAt?: boolean;
  }): Promise<{
    updated: number;
    failures: { elementKey: string; error: string }[];
  }>;
}

export interface IDashboardQueryService {
  run(input: DashboardQueryRunInput): Promise<DashboardQueryResult[]>;
}

export interface IChannelTasksService {
  list(channelId: string): Promise<ChannelTaskRecord[]>;
  file(input: {
    channelId: string;
    taskId: string;
    taskTitle: string;
  }): Promise<ChannelTaskRecord>;
  unfile(id: string): Promise<void>;
}
