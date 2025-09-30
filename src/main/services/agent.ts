import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { getCurrentBranch } from './git.js';
import { createAgent, ClaudeCodeAgent } from '@posthog/code-agent';

interface AgentStartParams {
    prompt: string;
    repoPath: string;
    model?: string;
}

interface TaskController {
    abortController: AbortController;
    agent: any;
    channel: string;
}

export function registerAgentIpc(taskControllers: Map<string, TaskController>, getMainWindow: () => BrowserWindow | null): void {
    ipcMain.handle('agent-start', async (_event: IpcMainInvokeEvent, { prompt, repoPath }: AgentStartParams): Promise<{ taskId: string; channel: string }> => {
        if (!prompt || !repoPath) {
            throw new Error('prompt and repoPath are required');
        }

        const agent = createAgent(
            new ClaudeCodeAgent({
                permissionMode: 'bypassPermissions'
            } as any)
        );

        const abortController = new AbortController();

        const currentBranch = (await getCurrentBranch(repoPath)) || 'unknown';

        const fullPrompt = `
    <context>
      Repository: ${repoPath}
      Branch: ${currentBranch}
      You have access to the local repository files for fast read/write operations.
      You also have access to GitHub via the GitHub MCP server for additional repository operations.
      Work with local files for your main implementation, and use GitHub MCP for any additional repository queries.
      Commit changes to the repository regularly.
    </context>

    <role>
      PostHog AI Coding Agent — autonomously transform a ticket into a merge-ready pull request that follows existing project conventions.
    </role>

    <tools>
      Local file system (for main implementation work)
      PostHog MCP server (for PostHog operations)
    </tools>

    <constraints>
      - Follow existing style and patterns you discover in the repo.
      - Try not to add new external dependencies, only if needed.
      - Implement structured logging and error handling; never log secrets.
      - Avoid destructive shell commands.
      - ALWAYS create appropriate .gitignore files to exclude build artifacts, dependencies, and temporary files.
    </constraints>

    <checklist>
      - Created or updated .gitignore file with appropriate exclusions
      - Created dependency files (requirements.txt, package.json, etc.) with exact versions
      - Added clear setup/installation instructions to README.md
      - Code compiles and tests pass.
      - Added or updated tests.
      - Captured meaningful events with PostHog SDK.
      - Wrapped new logic in an PostHog feature flag.
      - Updated docs, readme or type hints if needed.
      - Verified no build artifacts or dependencies are being committed
    </checklist>

    <ticket>
      ${prompt}
    </ticket>

    <task>
      Complete the ticket in a thoughtful step by step manner. Plan thoroughly and make sure to add logging and error handling as well as cover edge cases.
    </task>

    <workflow>
    - first make a plan and create a todo list
    - execute the todo list one by one
    - test the changes
    </workflow>

    <output_format>
      Once finished respond with a summary of changes made
    </output_format>

    <thinking>
      Use this area as a private scratch-pad for step-by-step reasoning; erase before final output.
    </thinking>
    `;

        const { taskId, stream } = await agent.run({
            prompt: fullPrompt,
            repoPath,
            permissionMode: 'permissive',
        });

        const channel = `agent-event:${taskId}`;

        taskControllers.set(taskId, { abortController, agent, channel });

        // Forward streaming events to renderer
        (async () => {
            try {
                for await (const ev of stream) {
                    const win = getMainWindow && getMainWindow();
                    if (win && !win.isDestroyed()) {
                        win.webContents.send(channel, ev);
                    }
                }
                const win = getMainWindow && getMainWindow();
                if (win && !win.isDestroyed()) {
                    win.webContents.send(channel, { type: 'done', success: true });
                }
            } catch (err) {
                const win = getMainWindow && getMainWindow();
                if (win && !win.isDestroyed()) {
                    win.webContents.send(channel, {
                        type: 'error',
                        message: err instanceof Error ? err.message : String(err),
                    });
                    win.webContents.send(channel, { type: 'done', success: false });
                }
            } finally {
                taskControllers.delete(taskId);
            }
        })();

        return { taskId, channel };
    });

    ipcMain.handle('agent-cancel', async (_event: IpcMainInvokeEvent, taskId: string): Promise<boolean> => {
        const entry = taskControllers.get(taskId);
        if (!entry) return false;
        try {
            entry.abortController.abort();
            if (entry.agent && typeof entry.agent.cancel === 'function') {
                try {
                    await entry.agent.cancel(taskId);
                } catch { }
            }
            return true;
        } finally {
            taskControllers.delete(taskId);
        }
    });
}