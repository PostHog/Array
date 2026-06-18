import { z } from "zod";
import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  WorkspaceServerEvent,
  type WorkspaceServerService,
} from "../../services/workspace-server/service";
import { publicProcedure, router } from "../trpc";

const connectionSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(1),
});

const getService = () =>
  container.get<WorkspaceServerService>(MAIN_TOKENS.WorkspaceServerService);

export const workspaceServerRouter = router({
  getConnection: publicProcedure.output(connectionSchema).query(async () => {
    const service = getService();
    return service.getConnection() ?? service.start();
  }),

  onConnectionLost: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(WorkspaceServerEvent.ConnectionLost, {
      signal: opts.signal,
    });
    for await (const data of iterable) {
      yield data;
    }
  }),
});
