import { readFileSync } from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { readMigrationFiles } from "drizzle-orm/migrator";

type SqliteDatabase = InstanceType<typeof Database>;

function isDuplicateColumnError(error: unknown): boolean {
  return error instanceof Error && /duplicate column name/i.test(error.message);
}

// Repair migrations heal DBs whose recorded history diverged from their real
// schema (a migration amended in place on a branch). Their statements are
// opportunistic: one that cannot apply must not roll back the batch and kill
// boot — for these migrations the worst acceptable outcome is the pre-repair
// status quo, never a database that fails to open. Statements in the listed
// migrations tolerate ANY SQLite error; everything else keeps the strict
// duplicate-column-only tolerance.
const BEST_EFFORT_MIGRATIONS = new Set<number>([
  1783685997328, // 0020_repair_browser_tabs_schema
]);

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
      const bestEffort = BEST_EFFORT_MIGRATIONS.has(migration.folderMillis);
      for (const statement of migration.sql) {
        try {
          sqlite.exec(statement);
        } catch (error) {
          if (bestEffort || isDuplicateColumnError(error)) {
            continue;
          }
          throw error;
        }
      }
      recordMigration.run(migration.hash, migration.folderMillis);
    }
  });

  applyPending();
  ensureBrowserTabsSchema(sqlite, migrationsFolder);
}

/**
 * Tables the post-migration heal covers. Deliberately only the browser-tab
 * strip's tables: they hold recoverable UI state, so the worst outcome of a
 * heal (or a rebuild) is an empty strip. Data-bearing tables are excluded on
 * purpose — fabricating defaults or rebuilding them would destroy real data,
 * and their drift should stay loud.
 */
const HEALED_TABLES = ["browser_windows", "browser_tabs"];

/** The subset of a drizzle meta snapshot the heal reads. */
interface SnapshotColumn {
  name: string;
  type: string;
  primaryKey: boolean;
  notNull: boolean;
  default?: unknown;
}
interface SnapshotTable {
  name: string;
  columns: Record<string, SnapshotColumn>;
  indexes: Record<
    string,
    { name: string; columns: string[]; isUnique: boolean }
  >;
  foreignKeys: Record<
    string,
    {
      tableFrom: string;
      tableTo: string;
      columnsFrom: string[];
      columnsTo: string[];
      onDelete?: string;
      onUpdate?: string;
    }
  >;
}

/**
 * The expected shape of the healed tables comes from the migration folder's
 * latest drizzle meta snapshot — the same machine-generated source of truth
 * drizzle-kit maintains alongside every migration. Deriving it (rather than
 * hardcoding DDL here) means a future migration that adds, drops, or moves a
 * column updates the heal automatically: hardcoded DDL would silently stop
 * covering new columns, and worse, would resurrect columns a later migration
 * deliberately dropped, on the same boot that dropped them.
 *
 * Returns null when the folder has no snapshot (e.g. a caller migrating an
 * unrelated DB with its own folder) — the heal then does nothing.
 */
function latestSnapshotTables(
  migrationsFolder: string,
): Record<string, SnapshotTable> | null {
  try {
    const journal = JSON.parse(
      readFileSync(
        path.join(migrationsFolder, "meta", "_journal.json"),
        "utf8",
      ),
    ) as { entries: { idx: number }[] };
    const last = journal.entries.at(-1);
    if (!last) return null;
    const snapshot = JSON.parse(
      readFileSync(
        path.join(
          migrationsFolder,
          "meta",
          `${String(last.idx).padStart(4, "0")}_snapshot.json`,
        ),
        "utf8",
      ),
    ) as { tables: Record<string, SnapshotTable> };
    return snapshot.tables;
  } catch {
    return null;
  }
}

function columnDdl(column: SnapshotColumn): string {
  let ddl = `\`${column.name}\` ${column.type}`;
  if (column.primaryKey) ddl += " PRIMARY KEY";
  // Snapshot defaults are already SQL-ready (booleans/numbers literal, strings
  // pre-quoted by drizzle-kit).
  if (column.default !== undefined) ddl += ` DEFAULT ${column.default}`;
  if (column.notNull) ddl += " NOT NULL";
  return ddl;
}

function createTableDdl(table: SnapshotTable): string {
  const columns = Object.values(table.columns).map(columnDdl);
  const foreignKeys = Object.values(table.foreignKeys).map(
    (fk) =>
      `FOREIGN KEY (${fk.columnsFrom.map((c) => `\`${c}\``).join(", ")}) ` +
      `REFERENCES \`${fk.tableTo}\`(${fk.columnsTo.map((c) => `\`${c}\``).join(", ")})` +
      ` ON UPDATE ${fk.onUpdate ?? "no action"} ON DELETE ${fk.onDelete ?? "no action"}`,
  );
  return `CREATE TABLE IF NOT EXISTS \`${table.name}\` (\n\t${[...columns, ...foreignKeys].join(",\n\t")}\n)`;
}

function createIndexDdls(table: SnapshotTable): string[] {
  return Object.values(table.indexes).map(
    (ix) =>
      `CREATE ${ix.isUnique ? "UNIQUE " : ""}INDEX IF NOT EXISTS \`${ix.name}\` ` +
      `ON \`${table.name}\` (${ix.columns.map((c) => `\`${c}\``).join(", ")})`,
  );
}

/**
 * Boot-time schema invariant for the browser-tabs tables, run after every
 * migration pass — deliberately NOT a one-shot migration. Dogfood DBs are
 * shared across branches whose builds reshape these tables (the amended 0013
 * variants, the panes branch that rebuilds `browser_tabs` without its target
 * columns), and a repair migration can only heal drift that predates it: once
 * the ledger records it as applied it never runs again, so a later rebuild by
 * another branch leaves every browser-tabs query throwing and the tab strip
 * dead (a lone "+" that does nothing).
 *
 * The heal, per table and checked against sqlite_master/PRAGMA so a healthy
 * DB does zero writes:
 * - table missing → CREATE it (and its indexes) from the snapshot;
 * - a nullable snapshot column missing → ALTER TABLE ADD COLUMN, leaving any
 *   extra columns another branch added alone, so that branch keeps working
 *   against the same DB;
 * - a NOT NULL / primary-key snapshot column missing → the variant is
 *   structurally foreign; rebuild (DROP + CREATE) rather than fabricate a
 *   default that would stamp existing rows with dangling '' references;
 * - a non-table (e.g. a VIEW) squatting on the name → skip; DDL can't heal it.
 *
 * Everything is best-effort: a statement (or the whole pass) that cannot
 * apply degrades to the pre-heal status quo, never a boot failure.
 */
function ensureBrowserTabsSchema(
  sqlite: SqliteDatabase,
  migrationsFolder: string,
): void {
  const bestEffort = (statement: string) => {
    try {
      sqlite.exec(statement);
    } catch {
      // Degrade to the pre-heal status quo, never a boot failure.
    }
  };

  try {
    const snapshotTables = latestSnapshotTables(migrationsFolder);
    if (!snapshotTables) return;
    const objectType = sqlite.prepare(
      "SELECT type FROM sqlite_master WHERE name = ?",
    );

    for (const name of HEALED_TABLES) {
      const table = Object.values(snapshotTables).find((t) => t.name === name);
      if (!table) continue;

      const existing = objectType.get(name) as { type: string } | undefined;
      if (existing && existing.type !== "table") continue;

      const createAll = () => {
        bestEffort(createTableDdl(table));
        for (const ddl of createIndexDdls(table)) bestEffort(ddl);
      };
      if (!existing) {
        createAll();
        continue;
      }

      const present = new Set(
        sqlite
          .prepare(`PRAGMA table_info(\`${name}\`)`)
          .all()
          .map((c) => (c as { name: string }).name),
      );
      const missing = Object.values(table.columns).filter(
        (c) => !present.has(c.name),
      );
      if (missing.length === 0) continue;

      if (missing.some((c) => c.notNull || c.primaryKey)) {
        // Structurally foreign variant — rebuild. Tabs are recoverable UI
        // state; an empty strip beats rows with fabricated NOT NULL values.
        bestEffort(`DROP TABLE IF EXISTS \`${name}\``);
        createAll();
        continue;
      }
      for (const column of missing) {
        bestEffort(`ALTER TABLE \`${name}\` ADD COLUMN ${columnDdl(column)}`);
      }
      for (const ddl of createIndexDdls(table)) bestEffort(ddl);
    }
  } catch {
    // The heal must never turn a working boot into a failed one.
  }
}
