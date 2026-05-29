import { eq } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { homeWorkflowConfig } from "../schema";
import type { DatabaseService } from "../service";

// Persists the Home workflow row for `LocalWorkflowBackend`. Deletion plan
// when workflow moves to PostHog: see `docs/workflow-architecture.md`.

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
    const existing = this.findById(row.id);
    if (existing) {
      this.db
        .update(homeWorkflowConfig)
        .set({
          version: row.version,
          json: row.json,
          updatedAt: row.updatedAt,
        })
        .where(eq(homeWorkflowConfig.id, row.id))
        .run();
      return;
    }
    this.db.insert(homeWorkflowConfig).values(row).run();
  }

  delete(id: string): void {
    this.db
      .delete(homeWorkflowConfig)
      .where(eq(homeWorkflowConfig.id, id))
      .run();
  }
}
