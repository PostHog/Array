import { desc, eq } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { DATABASE_SERVICE } from "../identifiers";
import { productEnvironments } from "../schema";
import type { DatabaseService } from "../service";

export interface ProductEnvironmentRow {
  id: string;
  projectId: number;
  label: string;
  pageOrigin: string;
  dataProjectId: number;
  currentUrl: string | null;
  createdAt: number;
  lastActiveAt: number;
}

export interface IProductEnvironmentsRepository {
  listByProject(projectId: number): ProductEnvironmentRow[];
  findById(id: string): ProductEnvironmentRow | null;
  upsert(row: ProductEnvironmentRow): void;
  remove(id: string): void;
}

@injectable()
export class ProductEnvironmentsRepository
  implements IProductEnvironmentsRepository
{
  constructor(
    @inject(DATABASE_SERVICE)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  listByProject(projectId: number): ProductEnvironmentRow[] {
    return this.db
      .select()
      .from(productEnvironments)
      .where(eq(productEnvironments.projectId, projectId))
      .orderBy(desc(productEnvironments.lastActiveAt))
      .all();
  }

  findById(id: string): ProductEnvironmentRow | null {
    const row = this.db
      .select()
      .from(productEnvironments)
      .where(eq(productEnvironments.id, id))
      .get();
    return row ?? null;
  }

  upsert(row: ProductEnvironmentRow): void {
    this.db
      .insert(productEnvironments)
      .values(row)
      .onConflictDoUpdate({
        target: productEnvironments.id,
        set: {
          label: row.label,
          pageOrigin: row.pageOrigin,
          dataProjectId: row.dataProjectId,
          currentUrl: row.currentUrl,
          lastActiveAt: row.lastActiveAt,
        },
      })
      .run();
  }

  remove(id: string): void {
    this.db
      .delete(productEnvironments)
      .where(eq(productEnvironments.id, id))
      .run();
  }
}
