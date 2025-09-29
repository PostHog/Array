
import { buildApiFetcher } from './fetcher';
import { createApiClient, type Schemas } from './generated';

export class PostHogAPIClient {
  private api: ReturnType<typeof createApiClient>;
  private _teamId: number | null = null;

  constructor(private apiKey: string, private apiHost: string) {
    const baseUrl = apiHost.endsWith('/') ? apiHost.slice(0, -1) : apiHost;
    this.api = createApiClient(
      buildApiFetcher({ apiToken: apiKey }),
      baseUrl
    );
  }
  
  private async getTeamId(): Promise<number> {
    if (this._teamId !== null) {
      return this._teamId;
    }
    
    const user = await this.api.get("/api/users/{uuid}/", {
      path: {uuid: "@me"}
    });
    
    if (user?.team?.id) {
      this._teamId = user.team.id;
      return this._teamId;
    }
    
    throw new Error('No team found for user');
  }
  
  async getCurrentUser() {
    const data = await this.api.get('/api/users/{uuid}/', {
      path: {uuid: "@me"}
    });
    return data;
  }
  
  async getTasks(repositoryOrg?: string, repositoryName?: string) {
    const teamId = await this.getTeamId();
    const params: Record<string, string> = {};
    
    if (repositoryOrg && repositoryName) {
      params['repository_config__organization'] = repositoryOrg;
      params['repository_config__repository'] = repositoryName;
    }
    
    const data = await this.api.get(`/api/projects/{project_id}/tasks/`, {
      path: {project_id: teamId.toString()},
      query: params
    });
    
    return data.results ?? []
  }
  
  async getTask(taskId: string) {
    const teamId = await this.getTeamId();
    const data = await this.api.get(`/api/projects/{project_id}/tasks/{id}/`, {
      path: {project_id: teamId.toString(), id: taskId}
    });
    return data;
  }
  
  async createTask(
    title: string, 
    description: string,
    repositoryConfig?: { organization: string; repository: string }
  ) {
    const teamId = await this.getTeamId();
    
    const payload = {
      title,
      description,
      origin_product: 'user_created',
      ...(repositoryConfig && { repository_config: repositoryConfig }),
    };
    
    const data = await this.api.post(`/api/projects/{project_id}/tasks/`, {
      path: {project_id: teamId.toString()},
      body: payload
    });
    
    return data;
  }
  
  async updateTask(taskId: string, updates: Partial<Schemas.Task>) {
    const teamId = await this.getTeamId();
    const data = await this.api.patch(`/api/projects/{project_id}/tasks/{id}/`, {
      path: {project_id: teamId.toString(), id: taskId},
      body: updates
    });

    return data;
  }
  
  async runTask(taskId: string) {
    // TODO: Pull this out and handle local and API calls
    const teamId = await this.getTeamId();
    const data = await this.api.patch(
      `/api/projects/{project_id}/tasks/{id}/update_stage/`,
      { path: {project_id: teamId.toString(), id: taskId}, body: { current_stage: "running" } }
    );

    return data;
  }
  
  async getTaskLogs(taskId: string): Promise<string> {
    const teamId = await this.getTeamId();
    const data = await this.api.get(
      `/api/projects/{project_id}/tasks/{id}/progress/`,
      { path: {project_id: teamId.toString(), id: taskId}}
    );
    return data.output_log ?? "";
  }
  
  async getWorkflows() {
    const teamId = await this.getTeamId();
    const data = await this.api.get(`/api/projects/{project_id}/workflows/`, {
      path: { project_id: teamId.toString() },
      query: { limit: 100, offset: 0 }
    });
    
    return data.results ?? []
  }
  
  async getWorkflowStages(workflowId: string) {
    const teamId = await this.getTeamId();
    const data = await this.api.get(`/api/projects/{project_id}/workflows/{workflow_id}/stages/`, {
      path: { project_id: teamId.toString(), workflow_id: workflowId },
      query: { limit: 100, offset: 0 }
    });
    
    return data.results ?? []
  }
}