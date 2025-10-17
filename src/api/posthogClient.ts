import type { LogEntry, RepositoryConfig, Task, TaskRun } from "@shared/types";
import { buildApiFetcher } from "./fetcher";
import { createApiClient, type Schemas } from "./generated";

export class PostHogAPIClient {
  private api: ReturnType<typeof createApiClient>;
  private _teamId: number | null = null;

  constructor(apiKey: string, apiHost: string) {
    const baseUrl = apiHost.endsWith("/") ? apiHost.slice(0, -1) : apiHost;
    this.api = createApiClient(buildApiFetcher({ apiToken: apiKey }), baseUrl);
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
    title: string,
    description: string,
    repositoryConfig?: { organization: string; repository: string },
    workflowId?: string,
  ) {
    const teamId = await this.getTeamId();

    const payload = {
      title,
      description,
      origin_product: "user_created" as const,
      ...(repositoryConfig && { repository_config: repositoryConfig }),
      ...(workflowId && { workflow: workflowId }),
    };

    const data = await this.api.post(`/api/projects/{project_id}/tasks/`, {
      path: { project_id: teamId.toString() },
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
      `${task.title} (copy)`,
      task.description,
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
      const task = (await this.getTask(taskId)) as Task;
      return task?.latest_run?.log ?? [];
    } catch (err) {
      console.warn("Failed to fetch task logs from latest run", err);
      return [];
    }
  }

  async getWorkflows() {
    const teamId = await this.getTeamId();
    const data = await this.api.get(`/api/projects/{project_id}/workflows/`, {
      path: { project_id: teamId.toString() },
      query: { limit: 100, offset: 0 },
    });

    return data.results ?? [];
  }

  async getWorkflowStages(workflowId: string) {
    const teamId = await this.getTeamId();
    const data = await this.api.get(
      `/api/projects/{project_id}/workflows/{workflow_id}/stages/`,
      {
        path: { project_id: teamId.toString(), workflow_id: workflowId },
        query: { limit: 100, offset: 0 },
      },
    );

    return data.results ?? [];
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

  async createWorkflow(data: {
    name: string;
    description?: string;
    color?: string;
    is_default?: boolean;
  }) {
    const teamId = await this.getTeamId();
    return await this.api.post("/api/projects/{project_id}/workflows/", {
      path: { project_id: teamId.toString() },
      body: {
        name: data.name,
        description: data.description,
        color: data.color,
        is_default: data.is_default ?? false,
        is_active: true,
      } as Schemas.TaskWorkflow,
    });
  }

  async updateWorkflow(
    workflowId: string,
    data: {
      name?: string;
      description?: string;
      color?: string;
      is_default?: boolean;
      is_active?: boolean;
    },
  ) {
    const teamId = await this.getTeamId();
    return await this.api.patch("/api/projects/{project_id}/workflows/{id}/", {
      path: { project_id: teamId.toString(), id: workflowId },
      body: data,
    });
  }

  async deactivateWorkflow(workflowId: string) {
    const teamId = await this.getTeamId();
    return await this.api.post(
      "/api/projects/{project_id}/workflows/{id}/deactivate/",
      {
        path: { project_id: teamId.toString(), id: workflowId },
      },
    );
  }

  async createStage(
    workflowId: string,
    data: {
      name: string;
      key: string;
      position: number;
      color?: string;
      agent_name?: string | null;
      is_manual_only?: boolean;
    },
  ) {
    const teamId = await this.getTeamId();
    return await this.api.post(
      "/api/projects/{project_id}/workflows/{workflow_id}/stages/",
      {
        path: {
          project_id: teamId.toString(),
          workflow_id: workflowId,
        },
        body: {
          ...data,
          workflow: workflowId,
        } as Schemas.WorkflowStage,
      },
    );
  }

  async updateStage(
    workflowId: string,
    stageId: string,
    data: {
      name?: string;
      key?: string;
      position?: number;
      color?: string;
      agent_name?: string | null;
      is_manual_only?: boolean;
      is_archived?: boolean;
    },
  ) {
    const teamId = await this.getTeamId();
    return await this.api.patch(
      "/api/projects/{project_id}/workflows/{workflow_id}/stages/{id}/",
      {
        path: {
          project_id: teamId.toString(),
          workflow_id: workflowId,
          id: stageId,
        },
        body: data,
      },
    );
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
}
