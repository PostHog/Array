import axios, { AxiosInstance } from 'axios';
import { Task, Workflow, User } from '@shared/types';

export class PostHogAPIClient {
  private api: AxiosInstance;
  private _teamId: number | null = null;
  
  constructor(private apiKey: string, private apiHost: string) {
    this.api = axios.create({
      baseURL: apiHost.endsWith('/') ? apiHost.slice(0, -1) : apiHost,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }
  
  private async getTeamId(): Promise<number> {
    if (this._teamId !== null) {
      return this._teamId;
    }
    
    const { data: user } = await this.api.get<User>('/api/users/@me');
    
    if (user.team?.id) {
      this._teamId = user.team.id;
      return this._teamId;
    }
    
    throw new Error('No team found for user');
  }
  
  async getCurrentUser(): Promise<User> {
    const { data } = await this.api.get<User>('/api/users/@me');
    return data;
  }
  
  async getTasks(repositoryOrg?: string, repositoryName?: string): Promise<Task[]> {
    const teamId = await this.getTeamId();
    const params: Record<string, string> = {};
    
    if (repositoryOrg && repositoryName) {
      params['repository_config__organization'] = repositoryOrg;
      params['repository_config__repository'] = repositoryName;
    }
    
    const { data } = await this.api.get(`/api/projects/${teamId}/tasks/`, { params });
    
    // Handle different response formats
    if (Array.isArray(data)) {
      return data;
    } else if (data.results) {
      return data.results;
    } else if (data.data) {
      return data.data;
    }
    
    return [];
  }
  
  async getTask(taskId: string): Promise<Task> {
    const teamId = await this.getTeamId();
    const { data } = await this.api.get<Task>(`/api/projects/${teamId}/tasks/${taskId}/`);
    return data;
  }
  
  async createTask(
    title: string, 
    description: string,
    repositoryConfig?: { organization: string; repository: string }
  ): Promise<Task> {
    const teamId = await this.getTeamId();
    
    const payload = {
      title,
      description,
      origin_product: 'user_created',
      ...(repositoryConfig && { repository_config: repositoryConfig }),
    };
    
    const { data } = await this.api.post<Task>(
      `/api/projects/${teamId}/tasks/`,
      payload
    );
    
    return data;
  }
  
  async updateTask(taskId: string, updates: Partial<Task>): Promise<Task> {
    const teamId = await this.getTeamId();
    const { data } = await this.api.patch<Task>(
      `/api/projects/${teamId}/tasks/${taskId}/`,
      updates
    );
    return data;
  }
  
  async runTask(taskId: string, mode: 'local' | 'cloud' = 'local'): Promise<{ id: string; status: string }> {
    const teamId = await this.getTeamId();
    const { data } = await this.api.post(
      `/api/projects/${teamId}/tasks/${taskId}/run`,
      { mode }
    );
    return data;
  }
  
  async getTaskLogs(taskId: string): Promise<string> {
    const teamId = await this.getTeamId();
    const { data } = await this.api.get(
      `/api/projects/${teamId}/tasks/${taskId}/logs`
    );
    return data;
  }
  
  async getWorkflows(): Promise<Workflow[]> {
    const teamId = await this.getTeamId();
    const { data } = await this.api.get(`/api/projects/${teamId}/workflows/`);
    
    if (Array.isArray(data)) {
      return data;
    } else if (data.results) {
      return data.results;
    } else if (data.data) {
      return data.data;
    }
    
    return [];
  }
  
  async getWorkflowStages(workflowId: string): Promise<any[]> {
    const teamId = await this.getTeamId();
    const { data } = await this.api.get(`/api/projects/${teamId}/workflows/${workflowId}/stages/`);
    
    if (Array.isArray(data)) {
      return data;
    } else if (data.results) {
      return data.results;
    }
    
    return [];
  }
}