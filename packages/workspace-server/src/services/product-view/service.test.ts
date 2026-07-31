import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProductEnvironmentsRepository } from "../../db/repositories/product-environments-repository";
import type { DatabaseService } from "../../db/service";
import { createTestDb, type TestDatabase } from "../../db/test-helpers";
import { ProductEnvironmentsService } from "./service";

let testDb: TestDatabase;
let service: ProductEnvironmentsService;

beforeEach(() => {
  testDb = createTestDb();
  const databaseService = { db: testDb.db } as unknown as DatabaseService;
  service = new ProductEnvironmentsService(
    new ProductEnvironmentsRepository(databaseService),
  );
});

afterEach(() => {
  testDb.close();
});

const input = (
  overrides: Partial<Parameters<typeof service.save>[0]> = {},
) => ({
  projectId: 2,
  label: "Production",
  pageOrigin: "https://us.posthog.com",
  dataProjectId: 2,
  ...overrides,
});

describe("ProductEnvironmentsService", () => {
  it("saves an environment and lists it for its project", () => {
    const saved = service.save(input());

    expect(saved.id).toBeTruthy();
    expect(saved.currentUrl).toBeNull();

    const listed = service.list(2);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      projectId: 2,
      label: "Production",
      pageOrigin: "https://us.posthog.com",
      dataProjectId: 2,
    });
  });

  it("scopes list to the requested project", () => {
    service.save(input({ projectId: 2 }));
    service.save(input({ projectId: 3, label: "Other" }));

    expect(service.list(2)).toHaveLength(1);
    expect(service.list(3).map((e) => e.label)).toEqual(["Other"]);
  });

  it("normalizes pageOrigin to a bare origin", () => {
    const saved = service.save(
      input({ pageOrigin: "https://us.posthog.com/some/path?q=1" }),
    );
    expect(saved.pageOrigin).toBe("https://us.posthog.com");
  });

  it("rejects a non-http(s) pageOrigin", () => {
    expect(() =>
      service.save(input({ pageOrigin: "file:///etc/passwd" })),
    ).toThrow(/http/i);
    expect(() => service.save(input({ pageOrigin: "not a url" }))).toThrow();
  });

  it("updates in place when saving with an existing id", () => {
    const saved = service.save(input());
    const updated = service.save({
      ...input({ label: "Prod (US)" }),
      id: saved.id,
    });

    expect(updated.id).toBe(saved.id);
    const listed = service.list(2);
    expect(listed).toHaveLength(1);
    expect(listed[0].label).toBe("Prod (US)");
  });

  it("touch records the current URL and bumps lastActiveAt", () => {
    const saved = service.save(input());

    const touched = service.touch(saved.id, "https://us.posthog.com/project/2");
    expect(touched?.currentUrl).toBe("https://us.posthog.com/project/2");
    expect(touched?.lastActiveAt).toBeGreaterThanOrEqual(saved.lastActiveAt);

    expect(service.list(2)[0].currentUrl).toBe(
      "https://us.posthog.com/project/2",
    );
  });

  it("touch ignores an unknown id", () => {
    expect(service.touch("nope", "https://x.example")).toBeNull();
  });

  it("remove deletes the environment", () => {
    const saved = service.save(input());
    service.remove(saved.id);
    expect(service.list(2)).toHaveLength(0);
  });

  it("lists most recently active first", () => {
    const a = service.save(input({ label: "A" }));
    const b = service.save(input({ label: "B" }));
    service.touch(a.id, "https://us.posthog.com/a", 1000);
    service.touch(b.id, "https://us.posthog.com/b", 2000);

    expect(service.list(2).map((e) => e.label)).toEqual(["B", "A"]);
  });
});
