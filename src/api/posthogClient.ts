import type { LogEntry, RepositoryConfig, Task, TaskRun } from "@shared/types";
import { buildApiFetcher } from "./fetcher";
import { createApiClient, type Schemas } from "./generated";

export class PostHogAPIClient {
  private api: ReturnType<typeof createApiClient>;
  private _teamId: number | null = null;

  constructor(
    accessToken: string,
    apiHost: string,
    onTokenRefresh?: () => Promise<string>,
    teamId?: number,
  ) {
    const baseUrl = apiHost.endsWith("/") ? apiHost.slice(0, -1) : apiHost;
    this.api = createApiClient(
      buildApiFetcher({
        apiToken: accessToken,
        onTokenRefresh,
      }),
      baseUrl,
    );
    if (teamId) {
      this._teamId = teamId;
    }
  }

  private async getTeamId(): Promise<number> {
    if (this._teamId !== null) {
      return this._teamId;
    }

    const user = await this.api.get("/api/users/{uuid}/", {
      path: { uuid: "@me" },
    });

    if (user?.team?.id) {
      this._teamId = user.team.id;
      return this._teamId;
    }

    throw new Error("No team found for user");
  }

  async getCurrentUser() {
    const data = await this.api.get("/api/users/{uuid}/", {
      path: { uuid: "@me" },
    });
    return data;
  }

  async getTasks(repositoryOrg?: string, repositoryName?: string) {
    const teamId = await this.getTeamId();
    const params: Record<string, string> = {};

    if (repositoryOrg && repositoryName) {
      params.repository_config__organization = repositoryOrg;
      params.repository_config__repository = repositoryName;
    }

    const data = await this.api.get(`/api/projects/{project_id}/tasks/`, {
      path: { project_id: teamId.toString() },
      query: params,
    });

    return data.results ?? [];
  }

  async getTask(taskId: string) {
    const teamId = await this.getTeamId();
    const data = await this.api.get(`/api/projects/{project_id}/tasks/{id}/`, {
      path: { project_id: teamId.toString(), id: taskId },
    });
    return data;
  }

  async createTask(
    description: string,
    repositoryConfig?: { organization: string; repository: string },
  ) {
    const teamId = await this.getTeamId();

    const payload = {
      description,
      origin_product: "user_created" as const,
      ...(repositoryConfig && { repository_config: repositoryConfig }),
    };

    const data = await this.api.post(`/api/projects/{project_id}/tasks/`, {
      path: { project_id: teamId.toString() },
      // @ts-expect-error (marking it as ignore since unrelated to this PR)
      body: payload as Schemas.Task,
    });

    return data;
  }

  async updateTask(taskId: string, updates: Partial<Schemas.Task>) {
    const teamId = await this.getTeamId();
    const data = await this.api.patch(
      `/api/projects/{project_id}/tasks/{id}/`,
      {
        path: { project_id: teamId.toString(), id: taskId },
        body: updates,
      },
    );

    return data;
  }

  async deleteTask(taskId: string) {
    const teamId = await this.getTeamId();
    await this.api.delete(`/api/projects/{project_id}/tasks/{id}/`, {
      path: { project_id: teamId.toString(), id: taskId },
    });
  }

  async duplicateTask(taskId: string) {
    const task = await this.getTask(taskId);
    return this.createTask(
      // @ts-expect-error (marking it as ignore since unrelated to this PR)
      task.description,
      // @ts-expect-error (marking it as ignore since unrelated to this PR)
      task.repository_config as RepositoryConfig | undefined,
    );
  }

  async runTask(taskId: string) {
    const teamId = await this.getTeamId();

    const data = await this.api.post(
      `/api/projects/{project_id}/tasks/{id}/run/`,
      {
        path: { project_id: teamId.toString(), id: taskId },
      },
    );

    return data;
  }

  async listTaskRuns(taskId: string): Promise<TaskRun[]> {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/projects/${teamId}/tasks/${taskId}/runs/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch task runs: ${response.statusText}`);
    }

    const data = await response.json();
    return data.results ?? data ?? [];
  }

  async getTaskRun(taskId: string, runId: string) {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/projects/${teamId}/tasks/${taskId}/runs/${runId}/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch task run: ${response.statusText}`);
    }

    return await response.json();
  }

  async getTaskLogs(taskId: string): Promise<LogEntry[]> {
    try {
      const task = (await this.getTask(taskId)) as unknown as Task;
      return task?.latest_run?.log ?? [];
    } catch (err) {
      console.warn("Failed to fetch task logs from latest run", err);
      return [];
    }
  }

  async getIntegrations() {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/integrations/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/environments/${teamId}/integrations/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch integrations: ${response.statusText}`);
    }

    const data = await response.json();
    return data.results ?? data ?? [];
  }

  async getGithubRepositories(integrationId: string | number) {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/integrations/${integrationId}/github_repos/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/environments/${teamId}/integrations/${integrationId}/github_repos/`,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch GitHub repositories: ${response.statusText}`,
      );
    }

    const data = await response.json();

    const integrations = await this.getIntegrations();
    const integration = integrations.find(
      (i: {
        id: number | string;
        display_name?: string;
        config?: { account?: { login?: string } };
      }) => i.id === integrationId,
    );
    const organization =
      integration?.display_name ||
      integration?.config?.account?.login ||
      "unknown";

    const repoNames = data.repositories ?? data.results ?? data ?? [];
    return repoNames.map((repoName: string) => ({
      organization,
      repository: repoName,
    }));
  }

  async getAgents() {
    const teamId = await this.getTeamId();
    const url = new URL(`${this.api.baseUrl}/api/projects/${teamId}/agents/`);
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/projects/${teamId}/agents/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch agents: ${response.statusText}`);
    }

    const data = await response.json();
    return data.results ?? data ?? [];
  }

  async getUsers() {
    const data = await this.api.get("/api/users/", {
      query: { limit: 1000 },
    });
    return data.results ?? [];
  }

  // Desktop Recordings API
  private validateRecordingId(recordingId: string): void {
    if (!recordingId || typeof recordingId !== "string") {
      throw new Error("Recording ID is required");
    }
    // UUID format validation (PostHog uses UUIDs for recording IDs)
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        recordingId,
      )
    ) {
      throw new Error("Invalid recording ID format");
    }
  }

  async createDesktopRecording(
    platform: string,
  ): Promise<Schemas.CreateRecordingResponse> {
    const teamId = await this.getTeamId();
    const data = await this.api.post(
      "/api/environments/{project_id}/desktop_recordings/",
      {
        path: { project_id: teamId.toString() },
        body: { platform } as Schemas.CreateRecordingRequest,
      },
    );
    return data;
  }

  async getDesktopRecording(recordingId: string) {
    this.validateRecordingId(recordingId);
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/desktop_recordings/${recordingId}/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/environments/${teamId}/desktop_recordings/${recordingId}/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch recording: ${response.statusText}`);
    }

    return await response.json();
  }

  async listDesktopRecordings(filters?: {
    platform?: string;
    status?: string;
    search?: string;
  }) {
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/desktop_recordings/`,
    );

    if (filters) {
      for (const [key, value] of Object.entries(filters)) {
        if (value) url.searchParams.set(key, value);
      }
    }

    const response = await this.api.fetcher.fetch({
      method: "get",
      url,
      path: `/api/environments/${teamId}/desktop_recordings/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to list recordings: ${response.statusText}`);
    }

    const data = await response.json();
    return data.results ?? data ?? [];
  }

  async deleteDesktopRecording(recordingId: string) {
    this.validateRecordingId(recordingId);
    const teamId = await this.getTeamId();
    const url = new URL(
      `${this.api.baseUrl}/api/environments/${teamId}/desktop_recordings/${recordingId}/`,
    );
    const response = await this.api.fetcher.fetch({
      method: "delete",
      url,
      path: `/api/environments/${teamId}/desktop_recordings/${recordingId}/`,
    });

    if (!response.ok) {
      throw new Error(`Failed to delete recording: ${response.statusText}`);
    }
  }

  async updateDesktopRecording(
    recordingId: string,
    updates: Partial<Schemas.PatchedDesktopRecording>,
  ) {
    this.validateRecordingId(recordingId);
    const teamId = await this.getTeamId();

    const data = await this.api.patch(
      "/api/environments/{project_id}/desktop_recordings/{id}/",
      {
        path: { project_id: teamId.toString(), id: recordingId },
        body: updates,
      },
    );

    return data;
  }

  async appendTranscriptSegments(
    recordingId: string,
    segments: Array<Schemas.TranscriptSegment>,
  ): Promise<Schemas.DesktopRecording> {
    this.validateRecordingId(recordingId);
    const teamId = await this.getTeamId();

    const data = await this.api.post(
      "/api/environments/{project_id}/desktop_recordings/{id}/append_segments/",
      {
        path: { project_id: teamId.toString(), id: recordingId },
        body: { segments } as Schemas.AppendSegments,
      },
    );

    return data;
  }
}
