import { container } from "../../di/container";
import { MAIN_TOKENS } from "../../di/tokens";
import {
  AuthServiceEvent,
  authStateSchema,
  loginInput,
  loginOutput,
  redeemInviteCodeInput,
  selectProjectInput,
  switchOrgInput,
  validAccessTokenOutput,
} from "../../services/auth/schemas";
import type { AuthService } from "../../services/auth/service";
import { publicProcedure, router } from "../trpc";

const getService = () => container.get<AuthService>(MAIN_TOKENS.AuthService);

export const authRouter = router({
  getState: publicProcedure.output(authStateSchema).query(() => {
    return getService().getState();
  }),

  onStateChanged: publicProcedure.subscription(async function* (opts) {
    const service = getService();
    const iterable = service.toIterable(AuthServiceEvent.StateChanged, {
      signal: opts.signal,
    });
    for await (const state of iterable) {
      yield state;
    }
  }),

  login: publicProcedure
    .input(loginInput)
    .output(loginOutput)
    .mutation(async ({ input }) => ({
      state: await getService().login(input.region),
    })),

  signup: publicProcedure
    .input(loginInput)
    .output(loginOutput)
    .mutation(async ({ input }) => ({
      state: await getService().signup(input.region),
    })),

  getValidAccessToken: publicProcedure
    .output(validAccessTokenOutput)
    .query(async () => getService().getValidAccessToken()),

  refreshAccessToken: publicProcedure
    .output(validAccessTokenOutput)
    .mutation(async () => getService().refreshAccessToken()),

  selectProject: publicProcedure
    .input(selectProjectInput)
    .output(authStateSchema)
    .mutation(async ({ input }) => getService().selectProject(input.projectId)),

  switchOrg: publicProcedure
    .input(switchOrgInput)
    .output(authStateSchema)
    .mutation(async ({ input }) => getService().switchOrg(input.orgId)),

  redeemInviteCode: publicProcedure
    .input(redeemInviteCodeInput)
    .output(authStateSchema)
    .mutation(async ({ input }) => getService().redeemInviteCode(input.code)),

  logout: publicProcedure.output(authStateSchema).mutation(async () => {
    return getService().logout();
  }),
});
