import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IStoragePaths } from "@posthog/platform/storage-paths";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { logger } from "../../utils/logger";
import {
  type DashboardRecord,
  type DashboardSummary,
  dashboardRecordSchema,
} from "./schemas";

const log = logger.scope("dashboards");

// File-backed dashboard store (MVP): each dashboard is a JSON file holding a
// json-render spec under <appData>/dashboards/<id>.json.
@injectable()
export class DashboardsService {
  constructor(
    @inject(MAIN_TOKENS.StoragePaths)
    private readonly storagePaths: IStoragePaths,
  ) {}

  private get dir(): string {
    return join(this.storagePaths.appDataPath, "dashboards");
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async list(): Promise<DashboardSummary[]> {
    await this.ensureDir();
    const entries = await readdir(this.dir);
    const records: DashboardRecord[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const record = await this.readFileRecord(join(this.dir, entry));
      if (record) records.push(record);
    }
    return records
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }));
  }

  async get(id: string): Promise<DashboardRecord | null> {
    return this.readFileRecord(this.filePath(id));
  }

  async create(input: {
    name: string;
    spec: Record<string, unknown> | null;
  }): Promise<DashboardRecord> {
    const now = Date.now();
    const record: DashboardRecord = {
      id: randomUUID(),
      name: input.name,
      spec: input.spec,
      createdAt: now,
      updatedAt: now,
    };
    await this.write(record);
    return record;
  }

  async update(input: {
    id: string;
    name?: string;
    spec: Record<string, unknown> | null;
  }): Promise<DashboardRecord> {
    const existing = await this.get(input.id);
    const now = Date.now();
    const record: DashboardRecord = {
      id: input.id,
      name: input.name ?? existing?.name ?? "Untitled dashboard",
      spec: input.spec,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await this.write(record);
    return record;
  }

  async delete(id: string): Promise<void> {
    try {
      await unlink(this.filePath(id));
    } catch (err) {
      // Already gone is a successful delete; surface anything else.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  private async write(record: DashboardRecord): Promise<void> {
    await this.ensureDir();
    await writeFile(this.filePath(record.id), JSON.stringify(record, null, 2));
  }

  private async readFileRecord(path: string): Promise<DashboardRecord | null> {
    try {
      const parsed = dashboardRecordSchema.safeParse(
        JSON.parse(await readFile(path, "utf8")),
      );
      return parsed.success ? parsed.data : null;
    } catch (err) {
      log.warn("Failed to read dashboard file", { path, err });
      return null;
    }
  }
}
