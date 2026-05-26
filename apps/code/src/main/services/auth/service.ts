import type { IPowerManager } from "@posthog/platform/power-manager";
import { OAUTH_SCOPE_VERSION } from "@shared/constants/oauth";
import { NotAuthenticatedError } from "@shared/errors";
import type { CloudRegion } from "@shared/types/regions";
import { type BackoffOptions, sleepWithBackoff } from "@shared/utils/backoff";
import { getCloudUrlFromRegion } from "@shared/utils/urls";
import { inject, injectable, postConstruct, preDestroy } from "inversify";
import type { IAuthPreferenceRepository } from "../../db/repositories/auth-preference-repository";
import type {
  IAuthSessionRepository,
  PersistAuthSessionInput,
} from "../../db/repositories/auth-session-repository";
import { MAIN_TOKENS } from "../../di/tokens";
import { decrypt, encrypt } from "../../utils/encryption";
import { logger } from "../../utils/logger";
import { TypedEventEmitter } from "../../utils/typed-event-emitter";
import {
  ConnectivityEvent,
  type ConnectivityStatusOutput,
} from "../connectivity/schemas";
import type { ConnectivityService } from "../connectivity/service";
import type { OAuthService } from "../oauth/service";
import {
  AuthServiceEvent,
  type AuthServiceEvents,
  type AuthState,
  type AuthTokenResponse,
  findOrgForProject,
  flattenProjectIds,
  type OrgProjects,
  type OrgProjectsMap,
  type ValidAccessTokenOutput,
} from "./schemas";

const log = logger.scope("auth-service");
const TOKEN_EXPIRY_SKEW_MS = 60_000;
type FetchLike = (
  input: string | Request,
  init?: RequestInit,
) => Promise<Response>;

interface InMemorySession {
  accountKey: string | null;
  accessToken: string;
  accessTokenExpiresAt: number;
  refreshToken: string;
  cloudRegion: CloudRegion;
  orgProjectsMap: OrgProjectsMap;
  currentOrgId: string | null;
  currentProjectId: number | null;
}

interface StoredSessionInput {
  refreshToken: string;
  cloudRegion: CloudRegion;
  selectedProjectId: number | null;
}

interface TokenResponseOptions {
  cloudRegion: CloudRegion;
  selectedProjectId: number | null;
}

function pickInitialProjectId(args: {
  orgProjectsMap: OrgProjectsMap;
  currentOrgId: string | null;
  lastSelectedOrgId: string | null;
  preferredProjectId: number | null;
}): number | null {
  const {
    orgProjectsMap,
    currentOrgId,
    lastSelectedOrgId,
    preferredProjectId,
  } = args;

  const allProjectIds = flattenProjectIds(orgProjectsMap);
  if (preferredProjectId && allProjectIds.includes(preferredProjectId)) {
    return preferredProjectId;
  }

  const fromCurrentOrg = currentOrgId
    ? orgProjectsMap[currentOrgId]?.projects[0]?.id
    : undefined;
  if (fromCurrentOrg !== undefined) return fromCurrentOrg;

  const fromLastOrg = lastSelectedOrgId
    ? orgProjectsMap[lastSelectedOrgId]?.projects[0]?.id
    : undefined;
  if (fromLastOrg !== undefined) return fromLastOrg;

  return allProjectIds[0] ?? null;
}

@injectable()
export class AuthService extends TypedEventEmitter<AuthServiceEvents> {
  private state: AuthState = {
    status: "anonymous",
    bootstrapComplete: false,
    cloudRegion: null,
    orgProjectsMap: {},
    currentOrgId: null,
    currentProjectId: null,
    hasCodeAccess: null,
    needsScopeReauth: false,
  };
  private session: InMemorySession | null = null;
  private initializePromise: Promise<void> | null = null;
  private refreshPromise: Promise<InMemorySession> | null = null;
  constructor(
    @inject(MAIN_TOKENS.AuthPreferenceRepository)
    private readonly authPreferenceRepository: IAuthPreferenceRepository,
    @inject(MAIN_TOKENS.AuthSessionRepository)
    private readonly authSessionRepository: IAuthSessionRepository,
    @inject(MAIN_TOKENS.OAuthService)
    private readonly oauthService: OAuthService,
    @inject(MAIN_TOKENS.ConnectivityService)
    private readonly connectivityService: ConnectivityService,
    @inject(MAIN_TOKENS.PowerManager)
    private readonly powerManager: IPowerManager,
  ) {
    super();
  }
  async initialize(): Promise<void> {
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.doInitialize();
    return this.initializePromise;
  }
  getState(): AuthState {
    return { ...this.state };
  }
  async login(region: CloudRegion): Promise<AuthState> {
    await this.authenticateWithFlow(
      () => this.oauthService.startFlow(region),
      region,
      "OAuth flow failed",
    );
    return this.getState();
  }
  async signup(region: CloudRegion): Promise<AuthState> {
    await this.authenticateWithFlow(
      () => this.oauthService.startSignupFlow(region),
      region,
      "Signup failed",
    );
    return this.getState();
  }
  async getValidAccessToken(): Promise<ValidAccessTokenOutput> {
    const override = process.env.VITE_POSTHOG_ACCESS_TOKEN_OVERRIDE;
    if (override) {
      await this.initialize();
      const region = this.session?.cloudRegion ?? "us";
      return {
        accessToken: override,
        apiHost: getCloudUrlFromRegion(region),
      };
    }

    await this.initialize();

    const session = await this.ensureValidSession();
    return {
      accessToken: session.accessToken,
      apiHost: getCloudUrlFromRegion(session.cloudRegion),
    };
  }
  async refreshAccessToken(): Promise<ValidAccessTokenOutput> {
    const override = process.env.VITE_POSTHOG_ACCESS_TOKEN_OVERRIDE;
    if (override) {
      await this.initialize();
      const region = this.session?.cloudRegion ?? "us";
      return {
        accessToken: override,
        apiHost: getCloudUrlFromRegion(region),
      };
    }

    await this.initialize();

    const session = await this.ensureValidSession(true);
    return {
      accessToken: session.accessToken,
      apiHost: getCloudUrlFromRegion(session.cloudRegion),
    };
  }
  async invalidateAccessTokenForTest(): Promise<void> {
    await this.initialize();

    if (!this.session) {
      return;
    }

    this.session = {
      ...this.session,
      accessToken: `${this.session.accessToken}_invalid`,
      // Keep the token apparently fresh so the next authenticated request
      // exercises the 401 -> refresh retry path instead of preemptive refresh.
      accessTokenExpiresAt: Date.now() + 5 * 60 * 1000,
    };
  }
  async authenticatedFetch(
    fetchImpl: FetchLike,
    input: string | Request,
    init: RequestInit = {},
  ): Promise<Response> {
    const initialAuth = await this.getValidAccessToken();
    let response = await this.executeAuthenticatedFetch(
      fetchImpl,
      input,
      init,
      initialAuth.accessToken,
    );

    if (response.status === 401 || response.status === 403) {
      const refreshedAuth = await this.refreshAccessToken();
      response = await this.executeAuthenticatedFetch(
        fetchImpl,
        input,
        init,
        refreshedAuth.accessToken,
      );
    }

    return response;
  }
  async redeemInviteCode(code: string): Promise<AuthState> {
    const { apiHost } = await this.getValidAccessToken();
    const response = await this.authenticatedFetch(
      fetch,
      `${apiHost}/api/code/invites/redeem/`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      },
    );

    const data = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
    };

    if (!response.ok || !data.success) {
      throw new Error(data.error || "Failed to redeem invite code");
    }

    this.updateState({ hasCodeAccess: true });
    return this.getState();
  }
  async selectProject(projectId: number): Promise<AuthState> {
    await this.initialize();

    const session = this.requireSession();

    if (!flattenProjectIds(session.orgProjectsMap).includes(projectId)) {
      throw new Error("Invalid project selection");
    }

    const newOrgId =
      findOrgForProject(
        session.orgProjectsMap,
        projectId,
        session.currentOrgId,
      ) ?? session.currentOrgId;

    const orgProjectsMap =
      newOrgId && newOrgId !== session.currentOrgId
        ? await this.applyOrgChange(session, newOrgId)
        : session.orgProjectsMap;

    this.commitSessionState(session, {
      orgProjectsMap,
      currentOrgId: newOrgId,
      currentProjectId: projectId,
    });
    return this.getState();
  }
  async switchOrg(orgId: string): Promise<AuthState> {
    await this.initialize();

    const session = this.requireSession();

    if (!session.orgProjectsMap[orgId]) {
      throw new Error("Invalid organization");
    }

    const orgProjectsMap = await this.applyOrgChange(session, orgId);
    const currentProjectId = this.pickProjectForOrg(
      session,
      orgProjectsMap,
      orgId,
    );

    this.commitSessionState(session, {
      orgProjectsMap,
      currentOrgId: orgId,
      currentProjectId,
    });
    return this.getState();
  }
  private async applyOrgChange(
    session: InMemorySession,
    orgId: string,
  ): Promise<OrgProjectsMap> {
    await this.patchCurrentOrganization(orgId);
    const refreshedProjects = await this.fetchOrgProjects(
      session.accessToken,
      session.cloudRegion,
      orgId,
    );
    if (!refreshedProjects) {
      return session.orgProjectsMap;
    }
    return {
      ...session.orgProjectsMap,
      [orgId]: {
        orgName: session.orgProjectsMap[orgId]?.orgName ?? "(unknown)",
        projects: refreshedProjects,
      },
    };
  }
  private pickProjectForOrg(
    session: InMemorySession,
    orgProjectsMap: OrgProjectsMap,
    orgId: string,
  ): number | null {
    const orgProjects = orgProjectsMap[orgId]?.projects ?? [];
    const preferredProjectId = session.accountKey
      ? (this.authPreferenceRepository.getOrgProject(
          session.accountKey,
          session.cloudRegion,
          orgId,
        )?.lastSelectedProjectId ?? null)
      : null;
    if (
      preferredProjectId &&
      orgProjects.some((p) => p.id === preferredProjectId)
    ) {
      return preferredProjectId;
    }
    return orgProjects[0]?.id ?? null;
  }
  private commitSessionState(
    prevSession: InMemorySession,
    next: {
      orgProjectsMap: OrgProjectsMap;
      currentOrgId: string | null;
      currentProjectId: number | null;
    },
  ): void {
    this.session = {
      ...prevSession,
      orgProjectsMap: next.orgProjectsMap,
      currentOrgId: next.currentOrgId,
      currentProjectId: next.currentProjectId,
    };

    this.persistProjectPreference(this.session);
    this.persistSession({
      refreshToken: this.session.refreshToken,
      cloudRegion: this.session.cloudRegion,
      selectedProjectId: next.currentProjectId,
    });

    this.updateState({
      orgProjectsMap: next.orgProjectsMap,
      currentOrgId: next.currentOrgId,
      currentProjectId: next.currentProjectId,
    });
  }
  private async patchCurrentOrganization(orgId: string): Promise<void> {
    const { apiHost } = await this.getValidAccessToken();
    const response = await this.authenticatedFetch(
      fetch,
      `${apiHost}/api/users/@me/`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ set_current_organization: orgId }),
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to switch organization: ${response.statusText}`);
    }
  }
  async logout(): Promise<AuthState> {
    const { cloudRegion, currentProjectId } = this.state;

    this.authSessionRepository.clearCurrent();
    this.session = null;
    this.setAnonymousState({ cloudRegion, currentProjectId });
    return this.getState();
  }
  private executeAuthenticatedFetch(
    fetchImpl: FetchLike,
    input: string | Request,
    init: RequestInit,
    accessToken: string,
  ): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${accessToken}`);

    return fetchImpl(input, {
      ...init,
      headers,
    });
  }
  private async doInitialize(): Promise<void> {
    const stored = this.authSessionRepository.getCurrent();

    if (!stored) {
      this.setAnonymousState({ bootstrapComplete: true });
      return;
    }

    if (stored.scopeVersion < OAUTH_SCOPE_VERSION) {
      this.session = null;
      this.setAnonymousState({
        bootstrapComplete: true,
        cloudRegion: stored.cloudRegion,
        currentProjectId: stored.selectedProjectId,
        needsScopeReauth: true,
      });
      return;
    }

    const storedSession = this.resolveStoredSession();
    if (!storedSession) {
      log.warn("Stored auth session could not be decrypted");
      this.authSessionRepository.clearCurrent();
      this.setAnonymousState({ bootstrapComplete: true });
      return;
    }

    try {
      await this.refreshAndSyncSession(storedSession);
    } catch (error) {
      log.warn("Failed to restore stored auth session", { error });
      this.session = null;
      this.setAnonymousState({
        bootstrapComplete: true,
        cloudRegion: storedSession.cloudRegion,
        currentProjectId: storedSession.selectedProjectId,
      });
    }
  }
  private async ensureValidSession(
    forceRefresh = false,
  ): Promise<InMemorySession> {
    if (
      this.session &&
      !forceRefresh &&
      !this.isSessionExpiring(this.session)
    ) {
      return this.session;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const sessionInput = this.getSessionInputForRefresh();

    this.refreshPromise = this.refreshSession(sessionInput).finally(() => {
      this.refreshPromise = null;
    });

    const session = await this.refreshPromise;
    await this.syncAuthenticatedSession(session);
    return session;
  }

  private getSessionInputForRefresh(): StoredSessionInput {
    if (this.session) {
      return {
        refreshToken: this.session.refreshToken,
        cloudRegion: this.session.cloudRegion,
        selectedProjectId: this.session.currentProjectId,
      };
    }

    const storedSession = this.resolveStoredSession();
    if (!storedSession) {
      throw new NotAuthenticatedError();
    }

    return storedSession;
  }
  private async refreshSession(
    input: StoredSessionInput,
  ): Promise<InMemorySession> {
    if (!this.connectivityService.getStatus().isOnline) {
      throw new Error("Offline");
    }

    let lastError = "Token refresh failed";

    for (
      let attempt = 0;
      attempt < AuthService.REFRESH_MAX_ATTEMPTS;
      attempt++
    ) {
      const result = await this.oauthService.refreshToken(
        input.refreshToken,
        input.cloudRegion,
      );

      if (result.success && result.data) {
        return await this.createSessionFromTokenResponse(result.data, input);
      }

      lastError = result.error || "Token refresh failed";

      if (result.errorCode === "auth_error") {
        log.warn("Refresh token rejected by server, forcing logout");
        this.authSessionRepository.clearCurrent();
        this.session = null;
        this.setAnonymousState({
          cloudRegion: input.cloudRegion,
          currentProjectId: input.selectedProjectId,
        });
        throw new Error(lastError);
      }

      const isRetryable =
        result.errorCode === "network_error" ||
        result.errorCode === "server_error";

      if (!isRetryable) {
        throw new Error(lastError);
      }

      const isLastAttempt = attempt === AuthService.REFRESH_MAX_ATTEMPTS - 1;
      if (isLastAttempt) break;

      log.warn("Transient refresh failure, retrying", {
        attempt,
        errorCode: result.errorCode,
      });
      await sleepWithBackoff(attempt, AuthService.REFRESH_BACKOFF);
    }

    throw new Error(lastError);
  }
  private async createSessionFromTokenResponse(
    tokenResponse: AuthTokenResponse,
    options: TokenResponseOptions,
  ): Promise<InMemorySession> {
    const scopedOrgIds = tokenResponse.scoped_organizations ?? [];
    const { accountKey, currentOrgId } = await this.fetchUserContext(
      tokenResponse.access_token,
      options.cloudRegion,
    );
    const orgProjectsMap = await this.buildOrgProjectsMap(
      tokenResponse.access_token,
      options.cloudRegion,
      scopedOrgIds,
    );
    const lastPrefs = accountKey
      ? this.authPreferenceRepository.get(accountKey, options.cloudRegion)
      : null;
    const currentProjectId = pickInitialProjectId({
      orgProjectsMap,
      currentOrgId,
      preferredProjectId:
        options.selectedProjectId ?? lastPrefs?.lastSelectedProjectId ?? null,
      lastSelectedOrgId: lastPrefs?.lastSelectedOrgId ?? null,
    });

    const session: InMemorySession = {
      accountKey,
      accessToken: tokenResponse.access_token,
      accessTokenExpiresAt: Date.now() + tokenResponse.expires_in * 1000,
      refreshToken: tokenResponse.refresh_token,
      cloudRegion: options.cloudRegion,
      orgProjectsMap,
      currentOrgId,
      currentProjectId,
    };

    return session;
  }
  private async buildOrgProjectsMap(
    accessToken: string,
    cloudRegion: CloudRegion,
    orgIds: string[],
  ): Promise<OrgProjectsMap> {
    const entries = await Promise.all(
      orgIds.map(async (orgId): Promise<[string, OrgProjects]> => {
        const result = await this.fetchOrgWithProjects(
          accessToken,
          cloudRegion,
          orgId,
        );
        return [orgId, result ?? { orgName: "(unknown)", projects: [] }];
      }),
    );

    return Object.fromEntries(entries);
  }
  private async fetchOrgProjects(
    accessToken: string,
    cloudRegion: CloudRegion,
    orgId: string,
  ): Promise<{ id: number; name: string }[] | null> {
    const result = await this.fetchOrgWithProjects(
      accessToken,
      cloudRegion,
      orgId,
    );
    return result?.projects ?? null;
  }
  private async fetchOrgWithProjects(
    accessToken: string,
    cloudRegion: CloudRegion,
    orgId: string,
  ): Promise<OrgProjects | null> {
    const apiHost = getCloudUrlFromRegion(cloudRegion);
    try {
      const res = await this.executeAuthenticatedFetch(
        fetch,
        `${apiHost}/api/organizations/${orgId}/`,
        {},
        accessToken,
      );
      if (!res.ok) return null;
      const raw = (await res.json().catch(() => null)) as {
        name?: unknown;
        teams?: unknown;
      } | null;
      const orgName =
        typeof raw?.name === "string" && raw.name.length > 0
          ? raw.name
          : "(unknown)";
      const teams = Array.isArray(raw?.teams) ? raw.teams : [];
      const projects = teams
        .map((t) => t as { id?: unknown; name?: unknown })
        .filter((t) => typeof t.id === "number" && typeof t.name === "string")
        .map((t) => ({ id: t.id as number, name: t.name as string }));
      return { orgName, projects };
    } catch (error) {
      log.warn("Failed to fetch org with projects", { orgId, error });
      return null;
    }
  }
  private async authenticateWithFlow(
    runFlow: () => Promise<{
      success: boolean;
      data?: AuthTokenResponse;
      error?: string;
    }>,
    region: CloudRegion,
    fallbackError: string,
  ): Promise<void> {
    const result = await runFlow();
    if (!result.success || !result.data) {
      throw new Error(result.error || fallbackError);
    }

    const session = await this.createSessionFromTokenResponse(result.data, {
      cloudRegion: region,
      selectedProjectId: this.state.currentProjectId,
    });
    await this.syncAuthenticatedSession(session);
  }
  private async refreshAndSyncSession(
    input: StoredSessionInput,
  ): Promise<void> {
    const session = await this.refreshSession(input);
    await this.syncAuthenticatedSession(session);
  }
  private async syncAuthenticatedSession(
    session: InMemorySession,
  ): Promise<void> {
    this.persistProjectPreference(session);
    this.persistSession({
      refreshToken: session.refreshToken,
      cloudRegion: session.cloudRegion,
      selectedProjectId: session.currentProjectId,
    });

    this.session = session;
    this.updateState({
      status: "authenticated",
      bootstrapComplete: true,
      cloudRegion: session.cloudRegion,
      orgProjectsMap: session.orgProjectsMap,
      currentOrgId: session.currentOrgId,
      currentProjectId: session.currentProjectId,
      needsScopeReauth: false,
    });
    await this.updateCodeAccessFromSession();
  }
  private persistSession(input: {
    refreshToken: string;
    cloudRegion: CloudRegion;
    selectedProjectId: number | null;
  }): void {
    const row: PersistAuthSessionInput = {
      refreshTokenEncrypted: encrypt(input.refreshToken),
      cloudRegion: input.cloudRegion,
      selectedProjectId: input.selectedProjectId,
      scopeVersion: OAUTH_SCOPE_VERSION,
    };

    this.authSessionRepository.saveCurrent(row);
  }
  private persistProjectPreference(session: InMemorySession): void {
    if (!session.accountKey) {
      return;
    }

    this.authPreferenceRepository.save({
      accountKey: session.accountKey,
      cloudRegion: session.cloudRegion,
      lastSelectedProjectId: session.currentProjectId,
      lastSelectedOrgId: session.currentOrgId,
    });

    const orgIdForProject = session.currentProjectId
      ? findOrgForProject(
          session.orgProjectsMap,
          session.currentProjectId,
          session.currentOrgId,
        )
      : null;
    if (orgIdForProject && session.currentProjectId) {
      this.authPreferenceRepository.saveOrgProject({
        accountKey: session.accountKey,
        cloudRegion: session.cloudRegion,
        orgId: orgIdForProject,
        lastSelectedProjectId: session.currentProjectId,
      });
    }
  }
  private isSessionExpiring(session: InMemorySession): boolean {
    return session.accessTokenExpiresAt - Date.now() <= TOKEN_EXPIRY_SKEW_MS;
  }
  private async fetchUserContext(
    accessToken: string,
    cloudRegion: "us" | "eu" | "dev",
  ): Promise<{ accountKey: string | null; currentOrgId: string | null }> {
    try {
      const response = await this.executeAuthenticatedFetch(
        fetch,
        `${getCloudUrlFromRegion(cloudRegion)}/api/users/@me/`,
        {},
        accessToken,
      );

      if (!response.ok) {
        return { accountKey: null, currentOrgId: null };
      }

      const data = (await response.json().catch(() => ({}))) as {
        uuid?: unknown;
        distinct_id?: unknown;
        email?: unknown;
        organization?: { id?: unknown } | null;
      };

      let accountKey: string | null = null;
      if (typeof data.uuid === "string" && data.uuid.length > 0) {
        accountKey = data.uuid;
      } else if (
        typeof data.distinct_id === "string" &&
        data.distinct_id.length > 0
      ) {
        accountKey = data.distinct_id;
      } else if (typeof data.email === "string" && data.email.length > 0) {
        accountKey = data.email;
      }

      const orgId = data.organization?.id;
      const currentOrgId =
        typeof orgId === "string" && orgId.length > 0 ? orgId : null;

      return { accountKey, currentOrgId };
    } catch (error) {
      log.warn("Failed to resolve user context", { error });
      return { accountKey: null, currentOrgId: null };
    }
  }
  private requireSession(): InMemorySession {
    if (!this.session) {
      throw new NotAuthenticatedError();
    }
    return this.session;
  }
  private setAnonymousState(
    partial: Pick<
      Partial<AuthState>,
      | "bootstrapComplete"
      | "cloudRegion"
      | "currentProjectId"
      | "needsScopeReauth"
    > = {},
  ): void {
    this.updateState({
      status: "anonymous",
      bootstrapComplete: partial.bootstrapComplete ?? true,
      cloudRegion: partial.cloudRegion ?? null,
      orgProjectsMap: {},
      currentOrgId: null,
      currentProjectId: partial.currentProjectId ?? null,
      hasCodeAccess: null,
      needsScopeReauth: partial.needsScopeReauth ?? false,
    });
  }
  private async updateCodeAccessFromSession(): Promise<void> {
    if (!this.session) {
      this.updateState({ hasCodeAccess: null });
      return;
    }

    try {
      const apiHost = getCloudUrlFromRegion(this.session.cloudRegion);
      const response = await this.executeAuthenticatedFetch(
        fetch,
        `${apiHost}/api/code/invites/check-access/`,
        {},
        this.session.accessToken,
      );
      const data = (await response.json().catch(() => ({}))) as {
        has_access?: boolean;
      };

      this.updateState({ hasCodeAccess: data.has_access === true });
    } catch (error) {
      log.warn("Failed to update code access state", { error });
      this.updateState({ hasCodeAccess: false });
    }
  }
  private static readonly REFRESH_MAX_ATTEMPTS = 3;
  private static readonly REFRESH_BACKOFF: BackoffOptions = {
    initialDelayMs: 1_000,
    maxDelayMs: 5_000,
    multiplier: 2,
  };
  private recoveryPromise: Promise<void> | null = null;
  private connectivityUnsubscribe: (() => void) | null = null;
  private resumeUnsubscribe: (() => void) | null = null;
  @postConstruct()
  init(): void {
    const handler = (status: ConnectivityStatusOutput) => {
      if (status.isOnline) {
        this.attemptSessionRecovery();
      }
    };
    this.connectivityService.on(ConnectivityEvent.StatusChange, handler);
    this.connectivityUnsubscribe = () => {
      this.connectivityService.off(ConnectivityEvent.StatusChange, handler);
    };

    this.resumeUnsubscribe = this.powerManager.onResume(this.handleResume);
  }
  @preDestroy()
  shutdown(): void {
    this.connectivityUnsubscribe?.();
    this.connectivityUnsubscribe = null;
    this.resumeUnsubscribe?.();
    this.resumeUnsubscribe = null;
  }
  private handleResume = (): void => {
    this.attemptSessionRecovery();
  };
  private resolveStoredSession(): StoredSessionInput | null {
    const stored = this.authSessionRepository.getCurrent();
    if (!stored) return null;

    const refreshToken = decrypt(stored.refreshTokenEncrypted);
    if (!refreshToken) return null;

    return {
      refreshToken,
      cloudRegion: stored.cloudRegion,
      selectedProjectId: stored.selectedProjectId,
    };
  }
  private attemptSessionRecovery(): void {
    if (this.session) return;
    if (this.recoveryPromise) return;

    const stored = this.authSessionRepository.getCurrent();
    if (!stored) return;
    if (stored.scopeVersion < OAUTH_SCOPE_VERSION) return;

    const storedSession = this.resolveStoredSession();
    if (!storedSession) return;

    this.recoveryPromise = this.refreshAndSyncSession(storedSession)
      .catch((error) => {
        log.warn("Session recovery failed", { error });
      })
      .finally(() => {
        this.recoveryPromise = null;
      });
  }

  private updateState(partial: Partial<AuthState>): void {
    this.state = {
      ...this.state,
      ...partial,
    };
    this.emit(AuthServiceEvent.StateChanged, this.getState());
  }
}
