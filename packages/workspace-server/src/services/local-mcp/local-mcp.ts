import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  LocalMcpServerDescriptor,
  LocalMcpTransport,
  PostHogMcpServerConfig,
} from "@posthog/shared";
import { parsePostHogMcpServers } from "@posthog/shared";
import { injectable } from "inversify";
import type { LocalMcpService } from "./identifiers";

function configPath(): string {
  return join(homedir(), ".posthog-code", "mcp.json");
}

function normalizeConfig(
  config: PostHogMcpServerConfig | null,
): LocalMcpTransport {
  if (config?.type === "http") {
    return {
      type: "http",
      url: config.url,
      headers: config.headers,
    };
  }
  if (config && "command" in config) {
    return {
      type: "stdio",
      command: config.command,
      args: config.args,
    };
  }
  return { type: "unknown" };
}

@injectable()
export class LocalMcpServiceImpl implements LocalMcpService {
  private updateQueue: Promise<unknown> = Promise.resolve();

  async listServers(): Promise<LocalMcpServerDescriptor[]> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(configPath(), "utf8"));
    } catch {
      return [];
    }
    return parsePostHogMcpServers(parsed).map((entry) => ({
      name: entry.name,
      scope: "user" as const,
      transport: normalizeConfig(entry.config),
    }));
  }

  async getConfigFile(): Promise<{ path: string; content: string | null }> {
    const path = configPath();
    try {
      return { path, content: await readFile(path, "utf8") };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { path, content: null };
      }
      throw error;
    }
  }

  async updateConfigFile(
    content: string,
  ): Promise<{ path: string; content: string }> {
    const update = this.updateQueue.then(() => this.writeConfigFile(content));
    this.updateQueue = update.catch(() => undefined);
    return update;
  }

  private async writeConfigFile(
    content: string,
  ): Promise<{ path: string; content: string }> {
    const path = configPath();
    const directory = dirname(path);
    const temporaryPath = join(directory, `.mcp-${randomUUID()}.tmp`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    try {
      await writeFile(temporaryPath, content, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(temporaryPath, path);
      await chmod(path, 0o600);
    } finally {
      await rm(temporaryPath, { force: true });
    }
    return { path, content };
  }
}
