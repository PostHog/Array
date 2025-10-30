export type CloudRegion = "us" | "eu" | "dev";

export interface OAuthTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  refresh_token: string;
  scoped_teams?: number[];
  scoped_organizations?: string[];
}

export interface OAuthConfig {
  scopes: string[];
  cloudRegion: CloudRegion;
}

export interface StoredOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  cloudRegion: CloudRegion;
}
