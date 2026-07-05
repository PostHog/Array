export interface RegisteredFolder {
  id: string;
  path: string;
  name: string;
  remoteUrl: string | null;
  lastAccessed: string;
  createdAt: string;
  exists?: boolean;
}
