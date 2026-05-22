import { eq } from "drizzle-orm";
import { inject, injectable } from "inversify";
import { MAIN_TOKENS } from "../../di/tokens";
import { forkRelationships } from "../schema";
import type { DatabaseService } from "../service";

export type ForkRelationship = typeof forkRelationships.$inferSelect;

export interface CreateForkRelationshipData {
  forkedTaskId: string;
  sourceTaskId: string;
  sourceTaskRunId: string;
  sourceTaskTitle: string;
  forkAtMessageIndex: number;
  forkedAt: string;
}

export interface IForkRelationshipRepository {
  create(data: CreateForkRelationshipData): ForkRelationship;
  findByForkedTaskId(forkedTaskId: string): ForkRelationship | null;
}

@injectable()
export class ForkRelationshipRepository implements IForkRelationshipRepository {
  constructor(
    @inject(MAIN_TOKENS.DatabaseService)
    private readonly databaseService: DatabaseService,
  ) {}

  private get db() {
    return this.databaseService.db;
  }

  create(data: CreateForkRelationshipData): ForkRelationship {
    return this.db
      .insert(forkRelationships)
      .values({
        id: crypto.randomUUID(),
        ...data,
      })
      .returning()
      .get();
  }

  findByForkedTaskId(forkedTaskId: string): ForkRelationship | null {
    return (
      this.db
        .select()
        .from(forkRelationships)
        .where(eq(forkRelationships.forkedTaskId, forkedTaskId))
        .get() ?? null
    );
  }
}
