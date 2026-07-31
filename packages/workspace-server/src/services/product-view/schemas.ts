import { z } from "zod";

// The environment record shape lives in @posthog/shared (the UI renders it);
// this module re-exports it beside the service's input schemas.
export {
  type ProductEnvironment,
  productEnvironmentSchema,
} from "@posthog/shared";

export const listProductEnvironmentsInput = z.object({
  projectId: z.number(),
});

export const saveProductEnvironmentInput = z.object({
  id: z.string().optional(),
  projectId: z.number(),
  label: z.string().min(1).max(120),
  pageOrigin: z.string().min(1).max(2000),
  dataProjectId: z.number(),
});
export type SaveProductEnvironmentInput = z.infer<
  typeof saveProductEnvironmentInput
>;

export const removeProductEnvironmentInput = z.object({ id: z.string() });

export const touchProductEnvironmentInput = z.object({
  id: z.string(),
  currentUrl: z.string().max(4000),
});
