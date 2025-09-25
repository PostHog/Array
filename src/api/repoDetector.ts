import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface RepoInfo {
  organization: string;
  repository: string;
  branch?: string;
  remote?: string;
}

export class RepoDetector {
  async getCurrentRepo(): Promise<RepoInfo | null> {
    try {
      // Get remote URL
      const { stdout: remoteUrl } = await execAsync('git remote get-url origin');
      const cleanUrl = remoteUrl.trim();
      
      // Parse GitHub URL
      let match = cleanUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
      if (!match) {
        // Try SSH format
        match = cleanUrl.match(/git@github\.com:(.+?)\/(.+?)(\.git)?$/);
      }
      
      if (!match) {
        return null;
      }
      
      const organization = match[1];
      const repository = match[2].replace(/\.git$/, '');
      
      // Get current branch
      let branch: string | undefined;
      try {
        const { stdout: branchName } = await execAsync('git branch --show-current');
        branch = branchName.trim();
      } catch {
        // Ignore branch detection errors
      }
      
      return {
        organization,
        repository,
        branch,
        remote: cleanUrl,
      };
    } catch {
      return null;
    }
  }
}