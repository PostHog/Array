import { inject, injectable } from "inversify";
import { PRODUCT_ENVIRONMENTS_REPOSITORY } from "../../db/identifiers";
import type { IProductEnvironmentsRepository } from "../../db/repositories/product-environments-repository";
import type {
  ProductEnvironment,
  SaveProductEnvironmentInput,
} from "./schemas";

export interface IProductEnvironmentsService {
  list(projectId: number): ProductEnvironment[];
  save(input: SaveProductEnvironmentInput): ProductEnvironment;
  remove(id: string): void;
  touch(
    id: string,
    currentUrl: string,
    now?: number,
  ): ProductEnvironment | null;
}

/** Reject anything but plain web origins — the embedded browser must never be
 * pointed at file:, chrome:, or custom schemes by persisted config. */
function normalizeOrigin(pageOrigin: string): string {
  let url: URL;
  try {
    url = new URL(pageOrigin);
  } catch {
    throw new Error(`Invalid page origin: ${pageOrigin}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Page origin must be http(s)");
  }
  return url.origin;
}

/**
 * Durable per-project registry of Product View environments (which sites the
 * Product tab can browse, and whose analytics overlay onto them).
 */
@injectable()
export class ProductEnvironmentsService implements IProductEnvironmentsService {
  constructor(
    @inject(PRODUCT_ENVIRONMENTS_REPOSITORY)
    private readonly repo: IProductEnvironmentsRepository,
  ) {}

  list(projectId: number): ProductEnvironment[] {
    return this.repo.listByProject(projectId);
  }

  save(input: SaveProductEnvironmentInput): ProductEnvironment {
    const now = Date.now();
    const pageOrigin = normalizeOrigin(input.pageOrigin);
    // Re-adding a site that's already registered updates it in place —
    // running the picker twice must not grow a second identical pill.
    const existing =
      (input.id ? this.repo.findById(input.id) : null) ??
      this.repo
        .listByProject(input.projectId)
        .find((env) => env.pageOrigin === pageOrigin) ??
      null;
    const record: ProductEnvironment = {
      id: existing?.id ?? input.id ?? crypto.randomUUID(),
      projectId: input.projectId,
      label: input.label,
      pageOrigin,
      dataProjectId: input.dataProjectId,
      currentUrl: existing?.currentUrl ?? null,
      createdAt: existing?.createdAt ?? now,
      lastActiveAt: existing?.lastActiveAt ?? now,
    };
    this.repo.upsert(record);
    return record;
  }

  remove(id: string): void {
    this.repo.remove(id);
  }

  touch(
    id: string,
    currentUrl: string,
    now: number = Date.now(),
  ): ProductEnvironment | null {
    const existing = this.repo.findById(id);
    if (!existing) return null;
    const next: ProductEnvironment = {
      ...existing,
      currentUrl,
      lastActiveAt: now,
    };
    this.repo.upsert(next);
    return next;
  }
}
