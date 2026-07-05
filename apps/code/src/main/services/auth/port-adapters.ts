import type {
  AuthOrgProjectPreferenceRecord,
  AuthPreferenceRecord,
  AuthSessionRecord,
  ConnectivityStatus,
  IAuthConnectivity,
  IAuthOAuthFlowService,
  IAuthPreferenceStore,
  IAuthSessionStore,
  IAuthTokenCipher,
  PersistAuthSessionRecord,
} from "@posthog/core/auth/identifiers";
import type {
  CancelFlowOutput,
  RefreshTokenOutput,
  StartFlowOutput,
} from "@posthog/core/auth/oauth.schemas";
import { OAUTH_SERVICE } from "@posthog/core/oauth/identifiers";
import type { OAuthService } from "@posthog/core/oauth/oauth";
import type { CloudRegion } from "@posthog/shared";
import type { WorkspaceClient } from "@posthog/workspace-client/client";
import type { IAuthPreferenceRepository } from "@posthog/workspace-server/db/repositories/auth-preference-repository";
import type { IAuthSessionRepository } from "@posthog/workspace-server/db/repositories/auth-session-repository";
import { inject, injectable } from "inversify";
import {
  AUTH_PREFERENCE_REPOSITORY,
  AUTH_SESSION_REPOSITORY,
  WORKSPACE_CLIENT,
} from "../../di/tokens";
import { decrypt, encrypt } from "../../utils/encryption";

@injectable()
export class TokenCipherPortAdapter implements IAuthTokenCipher {
  encrypt(plaintext: string): string {
    return encrypt(plaintext);
  }

  decrypt(encrypted: string): string | null {
    return decrypt(encrypted);
  }
}

@injectable()
export class OAuthFlowPortAdapter implements IAuthOAuthFlowService {
  constructor(
    @inject(OAUTH_SERVICE)
    private readonly oauth: OAuthService,
  ) {}

  startFlow(region: CloudRegion): Promise<StartFlowOutput> {
    return this.oauth.startFlow(region);
  }

  startSignupFlow(region: CloudRegion): Promise<StartFlowOutput> {
    return this.oauth.startSignupFlow(region);
  }

  refreshToken(
    refreshToken: string,
    region: CloudRegion,
  ): Promise<RefreshTokenOutput> {
    return this.oauth.refreshToken(refreshToken, region);
  }

  cancelFlow(): CancelFlowOutput {
    return this.oauth.cancelFlow();
  }
}

@injectable()
export class AuthSessionPortAdapter implements IAuthSessionStore {
  constructor(
    @inject(AUTH_SESSION_REPOSITORY)
    private readonly repository: IAuthSessionRepository,
  ) {}

  getCurrent(): AuthSessionRecord | null {
    const row = this.repository.getCurrent();
    if (!row) {
      return null;
    }
    return {
      refreshTokenEncrypted: row.refreshTokenEncrypted,
      cloudRegion: row.cloudRegion,
      selectedProjectId: row.selectedProjectId,
      scopeVersion: row.scopeVersion,
    };
  }

  saveCurrent(input: PersistAuthSessionRecord): void {
    this.repository.saveCurrent(input);
  }

  clearCurrent(): void {
    this.repository.clearCurrent();
  }
}

@injectable()
export class AuthPreferencePortAdapter implements IAuthPreferenceStore {
  constructor(
    @inject(AUTH_PREFERENCE_REPOSITORY)
    private readonly repository: IAuthPreferenceRepository,
  ) {}

  get(
    accountKey: string,
    cloudRegion: CloudRegion,
  ): AuthPreferenceRecord | null {
    const row = this.repository.get(accountKey, cloudRegion);
    if (!row) {
      return null;
    }
    return {
      accountKey: row.accountKey,
      cloudRegion: row.cloudRegion,
      lastSelectedProjectId: row.lastSelectedProjectId,
      lastSelectedOrgId: row.lastSelectedOrgId,
    };
  }

  save(input: AuthPreferenceRecord): void {
    this.repository.save(input);
  }

  getOrgProject(
    accountKey: string,
    cloudRegion: CloudRegion,
    orgId: string,
  ): AuthOrgProjectPreferenceRecord | null {
    const row = this.repository.getOrgProject(accountKey, cloudRegion, orgId);
    if (!row) {
      return null;
    }
    return {
      accountKey: row.accountKey,
      cloudRegion: row.cloudRegion,
      orgId: row.orgId,
      lastSelectedProjectId: row.lastSelectedProjectId,
    };
  }

  saveOrgProject(input: AuthOrgProjectPreferenceRecord): void {
    this.repository.saveOrgProject(input);
  }
}

@injectable()
export class ConnectivityPortAdapter implements IAuthConnectivity {
  private isOnline = true;
  private readonly handlers = new Set<(status: ConnectivityStatus) => void>();

  constructor(
    @inject(WORKSPACE_CLIENT)
    private readonly workspace: WorkspaceClient,
  ) {
    this.workspace.connectivity.onStatusChange.subscribe(undefined, {
      onData: (status) => {
        this.isOnline = status.isOnline;
        for (const handler of this.handlers) {
          handler({ isOnline: status.isOnline });
        }
      },
      onError: () => {},
    });
    void this.workspace.connectivity.getStatus
      .query()
      .then((status) => {
        this.isOnline = status.isOnline;
      })
      .catch(() => {});
  }

  getStatus(): ConnectivityStatus {
    return { isOnline: this.isOnline };
  }

  onStatusChange(handler: (status: ConnectivityStatus) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }
}
