import type { Container } from "inversify";

export interface Contribution {
  start(): void | Promise<void>;
}

export const CONTRIBUTION = Symbol.for("posthog.contribution");

export async function boot(container: Container): Promise<void> {
  if (!container.isBound(CONTRIBUTION)) {
    return;
  }

  const contributions = container.getAll<Contribution>(CONTRIBUTION);

  for (const contribution of contributions) {
    await contribution.start();
  }
}
