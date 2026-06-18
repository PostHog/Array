import { z } from "zod";

export const cloudRegion = z.enum(["us", "eu", "dev"]);
export type CloudRegion = z.infer<typeof cloudRegion>;

export const startIntegrationFlowInput = z.object({
  region: cloudRegion,
  projectId: z.number(),
});
export type StartIntegrationFlowInput = z.infer<
  typeof startIntegrationFlowInput
>;

export const startIntegrationFlowOutput = z.object({
  success: z.boolean(),
  error: z.string().optional(),
});
export type StartIntegrationFlowOutput = z.infer<
  typeof startIntegrationFlowOutput
>;
