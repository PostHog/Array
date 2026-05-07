import type { IPowerManager } from "@posthog/platform/power-manager";
import { OAUTH_SCOPE_VERSION } from "@shared/constants/oauth";
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
  projectId: number | null;
  availableProjectIds: number[];
  availableOrgIds: string[];
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

@injectable()
export class AuthService extends TypedEventEmitter<AuthServiceEvents> {
  private state: AuthState = {
    status: "anonymous",
    bootstrapComplete: false,
    cloudRegion: null,
    projectId: null,
    availableProjectIds: [],
    availableOrgIds: [],
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

    if (!session.availableProjectIds.includes(projectId)) {
      throw new Error("Invalid project selection");
    }

    this.session = {
      ...session,
      projectId,
    };

    this.persistProjectPreference(this.session);
    this.persistSession({
      refreshToken: this.session.refreshToken,
      cloudRegion: this.session.cloudRegion,
      selectedProjectId: projectId,
    });

    this.updateState({ projectId });
    return this.getState();
  }
  async logout(): Promise<AuthState> {
    const { cloudRegion, projectId } = this.state;

    this.authSessionRepository.clearCurrent();
    this.session = null;
    this.setAnonymousState({ cloudRegion, projectId });
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
        projectId: stored.selectedProjectId,
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
        projectId: storedSession.selectedProjectId,
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
        selectedProjectId: this.session.projectId,
      };
    }

    const storedSession = this.resolveStoredSession();
    if (!storedSession) {
      throw new Error("Not authenticated");
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
          projectId: input.selectedProjectId,
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
    const availableProjectIds = tokenResponse.scoped_teams ?? [];
    const availableOrgIds = tokenResponse.scoped_organizations ?? [];
    const accountKey = await this.fetchAccountKey(
      tokenResponse.access_token,
      options.cloudRegion,
    );
    const preferredProjectId =
      options.selectedProjectId ??
      (accountKey
        ? (this.authPreferenceRepository.get(accountKey, options.cloudRegion)
            ?.lastSelectedProjectId ?? null)
        : null);
    const projectId =
      preferredProjectId && availableProjectIds.includes(preferredProjectId)
        ? preferredProjectId
        : (availableProjectIds[0] ?? null);

    const session: InMemorySession = {
      accountKey,
      accessToken: tokenResponse.access_token,
      accessTokenExpiresAt: Date.now() + tokenResponse.expires_in * 1000,
      refreshToken: tokenResponse.refresh_token,
      cloudRegion: options.cloudRegion,
      projectId,
      availableProjectIds,
      availableOrgIds,
    };

    return session;
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
      selectedProjectId: this.state.projectId,
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
      selectedProjectId: session.projectId,
    });

    this.session = session;
    this.updateState({
      status: "authenticated",
      bootstrapComplete: true,
      cloudRegion: session.cloudRegion,
      projectId: session.projectId,
      availableProjectIds: session.availableProjectIds,
      availableOrgIds: session.availableOrgIds,
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
      lastSelectedProjectId: session.projectId,
    });
  }
  private isSessionExpiring(session: InMemorySession): boolean {
    return session.accessTokenExpiresAt - Date.now() <= TOKEN_EXPIRY_SKEW_MS;
  }
  private async fetchAccountKey(
    accessToken: string,
    cloudRegion: "us" | "eu" | "dev",
  ): Promise<string | null> {
    try {
      const response = await fetch(
        `${getCloudUrlFromRegion(cloudRegion)}/api/users/@me/`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!response.ok) {
        return null;
      }

      const data = (await response.json().catch(() => ({}))) as {
        uuid?: unknown;
        distinct_id?: unknown;
        email?: unknown;
      };

      if (typeof data.uuid === "string" && data.uuid.length > 0) {
        return data.uuid;
      }
      if (typeof data.distinct_id === "string" && data.distinct_id.length > 0) {
        return data.distinct_id;
      }
      if (typeof data.email === "string" && data.email.length > 0) {
        return data.email;
      }

      return null;
    } catch (error) {
      log.warn("Failed to resolve auth account key", { error });
      return null;
    }
  }
  private requireSession(): InMemorySession {
    if (!this.session) {
      throw new Error("Not authenticated");
    }
    return this.session;
  }
  private setAnonymousState(
    partial: Pick<
      Partial<AuthState>,
      "bootstrapComplete" | "cloudRegion" | "projectId" | "needsScopeReauth"
    > = {},
  ): void {
    this.updateState({
      status: "anonymous",
      bootstrapComplete: partial.bootstrapComplete ?? true,
      cloudRegion: partial.cloudRegion ?? null,
      projectId: partial.projectId ?? null,
      availableProjectIds: [],
      availableOrgIds: [],
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
