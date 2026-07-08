import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runMigrations } from "./migrate";

const MIGRATIONS_FOLDER = path.resolve(__dirname, "migrations");

const MID_HISTORY_ADD_COLUMN_TIMESTAMP = 1782781314961;

let sqlite: InstanceType<typeof Database>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
});

afterEach(() => {
  sqlite.close();
});

function ledgerMax(db: InstanceType<typeof Database>): number | null {
  const row = db
    .prepare("SELECT MAX(created_at) AS max FROM __drizzle_migrations")
    .get() as { max: number | null };
  return row.max;
}

function ledgerHas(
  db: InstanceType<typeof Database>,
  timestamp: number,
): boolean {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS count FROM __drizzle_migrations WHERE created_at = ?",
    )
    .get(timestamp) as { count: number };
  return row.count > 0;
}

function hasColumn(
  db: InstanceType<typeof Database>,
  table: string,
  column: string,
): boolean {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((c) => (c as { name: string }).name === column);
}

describe("runMigrations", () => {
  it("applies every migration on a fresh database", () => {
    runMigrations(sqlite, MIGRATIONS_FOLDER);

    expect(hasColumn(sqlite, "workspaces", "pr_urls")).toBe(true);
    expect(ledgerMax(sqlite)).not.toBeNull();
  });

  it("is a no-op when run twice", () => {
    runMigrations(sqlite, MIGRATIONS_FOLDER);
    const afterFirst = ledgerMax(sqlite);

    expect(() => runMigrations(sqlite, MIGRATIONS_FOLDER)).not.toThrow();
    expect(ledgerMax(sqlite)).toBe(afterFirst);
  });

  it("boots when the schema is already ahead of the migration ledger", () => {
    runMigrations(sqlite, MIGRATIONS_FOLDER);
    const latest = ledgerMax(sqlite);

    sqlite
      .prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?")
      .run(latest);
    expect(ledgerMax(sqlite)).not.toBe(latest);

    expect(() => runMigrations(sqlite, MIGRATIONS_FOLDER)).not.toThrow();
    expect(hasColumn(sqlite, "workspaces", "pr_urls")).toBe(true);
    expect(ledgerMax(sqlite)).toBe(latest);
  });

  it("re-applies a missing mid-history ledger entry", () => {
    runMigrations(sqlite, MIGRATIONS_FOLDER);

    sqlite
      .prepare("DELETE FROM __drizzle_migrations WHERE created_at = ?")
      .run(MID_HISTORY_ADD_COLUMN_TIMESTAMP);
    expect(ledgerHas(sqlite, MID_HISTORY_ADD_COLUMN_TIMESTAMP)).toBe(false);

    expect(() => runMigrations(sqlite, MIGRATIONS_FOLDER)).not.toThrow();
    expect(ledgerHas(sqlite, MID_HISTORY_ADD_COLUMN_TIMESTAMP)).toBe(true);
  });

  it("propagates errors other than duplicate-column conflicts", () => {
    const dir = writeTempMigration("DROP TABLE `table_that_does_not_exist`;");
    try {
      expect(() => runMigrations(sqlite, dir)).toThrow(/no such table/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not swallow an 'already exists' conflict from a new migration", () => {
    sqlite.exec("CREATE TABLE existing_table (id text)");
    const dir = writeTempMigration(
      "CREATE TABLE `existing_table` (`id` text);",
    );
    try {
      expect(() => runMigrations(sqlite, dir)).toThrow(/already exists/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function writeTempMigration(sql: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "migrate-test-"));
  mkdirSync(path.join(dir, "meta"), { recursive: true });
  writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "sqlite",
      entries: [
        { idx: 0, version: "6", when: 1, tag: "0000_temp", breakpoints: true },
      ],
    }),
  );
  writeFileSync(path.join(dir, "0000_temp.sql"), sql);
  return dir;
}
