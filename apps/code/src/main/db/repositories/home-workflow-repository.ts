import { eq } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { homeWorkflowConfig } from "../schema";
import type { DatabaseService } from "../service";

// Persists the Home workflow row for `LocalWorkflowBackend`.
export interface PersistedWorkflowRow {
  id: string;
  version: number;
  json: string;
  updatedAt: string;
}

@injectable()
export class HomeWorkflowRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  findById(id: string): PersistedWorkflowRow | null {
    const row = this.db
      .select()
      .from(homeWorkflowConfig)
      .where(eq(homeWorkflowConfig.id, id))
      .get();
    return row ?? null;
  }

  upsert(row: PersistedWorkflowRow): void {
    this.db
      .insert(homeWorkflowConfig)
      .values(row)
      .onConflictDoUpdate({
        target: homeWorkflowConfig.id,
        set: { version: row.version, json: row.json, updatedAt: row.updatedAt },
      })
      .run();
  }

  delete(id: string): void {
    this.db
      .delete(homeWorkflowConfig)
      .where(eq(homeWorkflowConfig.id, id))
      .run();
  }
}
