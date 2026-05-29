export const CLOUD_TASK_SERVICE = Symbol.for("posthog.core.cloudTaskService");
export const CLOUD_TASK_AUTH = Symbol.for("posthog.core.cloudTaskAuth");

export interface ICloudTaskAuth {
  authenticatedFetch(url: string, init?: RequestInit): Promise<Response>;
}
