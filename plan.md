# OAuth Authentication Implementation Plan

This document outlines the phased implementation plan for replacing API key authentication with OAuth in the Array app.

## Overview

- **Goal**: Replace manual API key entry with "Sign in with PostHog" OAuth flow
- **Strategy**: OAuth only (remove API key option)
- **Callback**: Localhost HTTP server on port 8239 (same as CLI)
- **Regions**: Support US/EU/Dev with region selector
- **Token Refresh**: Proactive background refresh + reactive 401 handling + refresh token rotation

## Stage 1: Core OAuth Infrastructure

**PR 1: Add OAuth service and IPC handlers**

### Files to Create:
- `src/shared/constants/oauth.ts` - OAuth constants (client IDs, port, scopes)
- `src/shared/types/oauth.ts` - TypeScript types (CloudRegion, OAuthTokenResponse, etc.)
- `src/main/services/oauth.ts` - OAuth service with PKCE flow

### Files to Modify:
- `src/main/index.ts` - Register OAuth IPC handlers
- `src/main/preload.ts` - Add OAuth IPC type definitions

### Implementation Details:
1. **OAuth Constants** (`src/shared/constants/oauth.ts`)
   - Client IDs: `POSTHOG_US_CLIENT_ID`, `POSTHOG_EU_CLIENT_ID`, `POSTHOG_DEV_CLIENT_ID`
   - `OAUTH_PORT = 8239`
   - OAuth scopes array
   - Helper functions: `getCloudUrlFromRegion()`, `getOauthClientIdFromRegion()`

2. **OAuth Types** (`src/shared/types/oauth.ts`)
   - `CloudRegion`: 'us' | 'eu' | 'dev'
   - `OAuthTokenResponse`: access_token, refresh_token, expires_in, etc.
   - `OAuthConfig`: scopes, cloudRegion

3. **OAuth Service** (`src/main/services/oauth.ts`)
   - PKCE functions: `generateCodeVerifier()`, `generateCodeChallenge()`
   - `startCallbackServer()` - HTTP server handling `/authorize` and `/callback`
   - `exchangeCodeForToken()` - Code exchange with PostHog
   - `performOAuthFlow()` - Main orchestration function
   - Token encryption using `safeStorage`
   - IPC handlers: `startOAuthFlow`, `storeOAuthTokens`, `retrieveOAuthTokens`, `deleteOAuthTokens`, `refreshOAuthToken`

4. **IPC Registration** (`src/main/index.ts`)
   - Import OAuth handlers
   - Register on app initialization

5. **Preload Types** (`src/main/preload.ts`)
   - Add OAuth methods to `electronAPI` interface
   - Type-safe IPC bridge for renderer

### Testing:
- Verify OAuth server starts on port 8239
- Test PKCE code generation
- Verify token encryption/decryption
- Test IPC communication between renderer and main

---

## Stage 2: State Management & Token Refresh

**PR 2: Refactor authStore and add token refresh logic**

### Files to Modify:
- `src/renderer/features/auth/stores/authStore.ts` - Refactor for OAuth state
- `src/api/fetcher.ts` - Add OAuth token and 401 handling
- `src/api/posthogClient.ts` - Update constructor for OAuth

### Implementation Details:

1. **AuthStore Refactor** (`authStore.ts`)
   - **Remove**: `apiKey`, `encryptedKey`, `openaiApiKey`, `encryptedOpenaiKey`
   - **Add**:
     - `oauthAccessToken: string | null`
     - `oauthRefreshToken: string | null`
     - `tokenExpiry: number | null` (Unix timestamp)
     - `cloudRegion: CloudRegion | null`
   - **Methods**:
     - `loginWithOAuth(region: CloudRegion)` - Calls IPC to start OAuth flow
     - `refreshAccessToken()` - Refresh token logic with rotation handling
     - `scheduleTokenRefresh()` - Proactive refresh 5 mins before expiry
     - `initializeOAuth()` - Restore session on app launch
     - `logout()` - Clear OAuth tokens

2. **Token Refresh Logic**:
   - Proactive: `setTimeout` scheduled refresh (expires_in - 5min)
   - Reactive: 401 interceptor in fetcher
   - Handle refresh token rotation (update both tokens)
   - On refresh failure: logout and show AuthScreen

3. **API Fetcher Update** (`fetcher.ts`)
   - Change `Authorization` header to use OAuth access token
   - Add response interceptor:
     ```typescript
     if (response.status === 401) {
       await authStore.getState().refreshAccessToken();
       // Retry original request
     }
     ```
   - Remove API key logic

4. **PostHog Client Update** (`posthogClient.ts`)
   - Constructor takes `accessToken` and `apiHost`
   - Derive `apiHost` from `cloudRegion`

### Testing:
- Test token refresh on 401 response
- Test proactive token refresh
- Test refresh token rotation
- Test logout clears all OAuth state

---

## Stage 3: UI Updates

**PR 3: Update AuthScreen and SettingsView for OAuth**

### Files to Modify:
- `src/renderer/features/auth/components/AuthScreen.tsx` - OAuth UI
- `src/renderer/features/settings/components/SettingsView.tsx` - OAuth status display
- `src/renderer/App.tsx` - Update auth initialization

### Implementation Details:

1. **AuthScreen Redesign** (`AuthScreen.tsx`)
   - **Add**: Region selector (RadioGroup with US/EU/Dev options)
   - **Replace**: API key form with "Sign in with PostHog" button
   - **Add**: Loading state ("Waiting for authorization...")
   - **Add**: Error state handling (timeout, access denied, etc.)
   - **Remove**: API key TextField, custom host TextField
   - Layout: Keep two-pane design, left side has region selector + button

2. **SettingsView Update** (`SettingsView.tsx`)
   - **Show**: OAuth connection status
     - Region badge (US/EU/Dev)
     - Connected account email (if available from token)
   - **Add**: "Re-authenticate" button
   - **Update**: "Sign out" button (calls OAuth logout)
   - **Remove**: API key display/edit fields

3. **App.tsx Update**
   - Call `authStore.initializeOAuth()` on mount
   - Handle token expiry edge cases

### Testing:
- Test OAuth flow from AuthScreen
- Test region switching
- Test error states (timeout, denial)
- Test re-authentication from Settings
- Test logout flow

---

## Stage 4: Cleanup & Polish

**PR 4: Remove API key code and final cleanup**

### Files to Modify:
- `src/main/services/posthog.ts` - Remove API key IPC handlers
- Clean up any unused imports/types

### Implementation Details:

1. **Remove API Key Code**:
   - Delete `storeApiKey`, `retrieveApiKey` IPC handlers
   - Remove API key encryption logic (if not used elsewhere)
   - Clean up unused imports

2. **Migration Considerations**:
   - Old encrypted API keys in localStorage will be orphaned (acceptable)
   - Users will need to re-authenticate with OAuth

3. **Documentation**:
   - Update README if it mentions API keys
   - Add OAuth setup instructions

### Testing:
- Full end-to-end OAuth flow for all regions
- Test app launch with existing OAuth session
- Test app launch without session (shows AuthScreen)
- Test token refresh scenarios
- Test logout and re-authentication

---

## OAuth Flow Sequence

```
1. User selects region (US/EU/Dev)
   ↓
2. User clicks "Sign in with PostHog"
   ↓
3. Renderer calls IPC: startOAuthFlow(region)
   ↓
4. Main process starts HTTP server on localhost:8239
   ↓
5. Main process opens browser to localhost:8239/authorize
   ↓
6. Browser redirects to PostHog OAuth page (with PKCE challenge)
   ↓
7. User authorizes on PostHog
   ↓
8. PostHog redirects to localhost:8239/callback?code=...
   ↓
9. Callback server receives code
   ↓
10. Main process exchanges code for tokens
    ↓
11. Main process encrypts tokens
    ↓
12. Main process returns tokens to renderer via IPC
    ↓
13. Renderer updates authStore
    ↓
14. Renderer creates PostHog client with access token
    ↓
15. Schedule proactive token refresh
    ↓
16. Authenticated! 🎉
```

## Token Refresh Flow

```
Proactive Refresh (every ~55 mins for 60-min tokens):
- setTimeout scheduled on login/refresh
- Calls refresh endpoint 5 mins before expiry
- Updates both access + refresh tokens
- Reschedules next refresh

Reactive Refresh (on 401):
- API request returns 401
- Interceptor calls refreshAccessToken()
- Retries original request with new token
- If refresh fails: logout user
```

## Key Dependencies

- `crypto` (Node.js) - PKCE code generation
- `http` (Node.js) - Callback server
- `electron.safeStorage` - Token encryption
- `open` or `electron.shell.openExternal` - Browser opening

## Environment Variables

Consider adding to `.env` (optional):
```bash
POSTHOG_OAUTH_CLIENT_ID_US=c4Rdw8DIxgtQfA80IiSnGKlNX8QN00cFWF00QQhM
POSTHOG_OAUTH_CLIENT_ID_EU=bx2C5sZRN03TkdjraCcetvQFPGH6N2Y9vRLkcKEy
POSTHOG_OAUTH_CLIENT_ID_DEV=DC5uRLVbGI02YQ82grxgnK6Qn12SXWpCqdPb60oZ
```

## Testing Checklist

- [x] OAuth flow completes successfully for US region
- [x] OAuth flow completes successfully for EU region
- [x] OAuth flow completes successfully for Dev region
- [x] Proactive token refresh works
- [x] Reactive token refresh works on 401
- [x] Refresh token rotation updates both tokens
- [x] Logout clears all OAuth state
- [x] App restart with valid tokens restores session
- [x] App restart without tokens shows AuthScreen
- [x] Timeout handling (60s limit)
- [x] User denies access handling
- [x] Port 8239 conflict handling
- [ ] Network error handling
- [ ] Token expiry edge cases
