import type Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

type SqliteDatabase = InstanceType<typeof Database>;

function isDuplicateColumnError(error: unknown): boolean {
  return error instanceof Error && /duplicate column name/i.test(error.message);
}

export function runMigrations(
  sqlite: SqliteDatabase,
  migrationsFolder: string,
): void {
  const migrations = readMigrationFiles({ migrationsFolder });

  sqlite.exec(
    "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)",
  );

  const appliedTimestamps = new Set(
    sqlite
      .prepare("SELECT created_at FROM __drizzle_migrations")
      .all()
      .map((row) => Number((row as { created_at: number }).created_at)),
  );

  const recordMigration = sqlite.prepare(
    "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
  );

  const applyPending = sqlite.transaction(() => {
    for (const migration of migrations) {
      if (appliedTimestamps.has(migration.folderMillis)) {
        continue;
      }
      for (const statement of migration.sql) {
        try {
          sqlite.exec(statement);
        } catch (error) {
          if (isDuplicateColumnError(error)) {
            continue;
          }
          throw error;
        }
      }
      recordMigration.run(migration.hash, migration.folderMillis);
    }
  });

  applyPending();
}
