import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import { promptInput, promptOutput } from "../../services/llm-gateway/schemas";
import type { LlmGatewayService } from "../../services/llm-gateway/service";
import { publicProcedure, router } from "../trpc";

const getService = () =>
  container.get<LlmGatewayService>(MAIN_TOKENS.LlmGatewayService);

export const llmGatewayRouter = router({
  prompt: publicProcedure
    .input(promptInput)
    .output(promptOutput)
    .mutation(({ input }) =>
      getService().prompt(input.messages, {
        system: input.system,
        maxTokens: input.maxTokens,
        model: input.model,
      }),
    ),

  invalidatePlanCache: publicProcedure.mutation(() =>
    getService().invalidatePlanCache(),
  ),
});
