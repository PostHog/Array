import { z } from "zod";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import type { LocalLogsService } from "../../services/local-logs/service";
import { logger } from "../../utils/logger";
import { publicProcedure, router } from "../trpc";

const log = logger.scope("logsRouter");

const getLocalLogsService = (): LocalLogsService =>
  container.get<LocalLogsService>(MAIN_TOKENS.LocalLogsService);

export const logsRouter = router({
  fetchS3Logs: publicProcedure
    .input(z.object({ logUrl: z.string() }))
    .query(async ({ input }) => {
      try {
        const response = await fetch(input.logUrl);

        if (response.status === 404) {
          return null;
        }

        if (!response.ok) {
          log.warn(
            "Failed to fetch S3 logs:",
            response.status,
            response.statusText,
          );
          return null;
        }

        return await response.text();
      } catch (error) {
        log.error("Failed to fetch S3 logs:", error);
        return null;
      }
    }),

  readLocalLogs: publicProcedure
    .input(z.object({ taskRunId: z.string() }))
    .query(({ input }) => getLocalLogsService().readLocalLogs(input.taskRunId)),

  writeLocalLogs: publicProcedure
    .input(z.object({ taskRunId: z.string(), content: z.string() }))
    .mutation(({ input }) =>
      getLocalLogsService().writeLocalLogs(input.taskRunId, input.content),
    ),
});
