import { z } from "zod";

/**
 * A Product View environment: which site the Product tab browses and which
 * PostHog project's analytics overlay onto it. Page source and data source are
 * decoupled so a localhost checkout can render production analytics. Persisted
 * per PostHog project by workspace-server; rendered by the UI — hence the
 * shape lives here, host-neutral.
 */
export const productEnvironmentSchema = z.object({
  id: z.string(),
  projectId: z.number(),
  label: z.string(),
  /** Bare http(s) origin the embedded browser opens. */
  pageOrigin: z.string(),
  /** PostHog project whose analytics overlay onto the page. */
  dataProjectId: z.number(),
  /** Last URL visited in this environment, for tab restore. */
  currentUrl: z.string().nullable(),
  createdAt: z.number(),
  lastActiveAt: z.number(),
});
export type ProductEnvironment = z.infer<typeof productEnvironmentSchema>;
