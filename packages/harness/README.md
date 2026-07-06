# @posthog/harness

Spawn the [pi.dev](https://pi.dev) coding agent — both its **CLI** and its **SDK** — against the
PostHog LLM gateway, authenticated with the same OAuth flow as PostHog Code.

Harness registers a pi provider named `posthog` that:

- points pi's `anthropic-messages` API at the region's LLM gateway
  (`https://gateway.<region>.posthog.com/posthog_code`),
- authenticates with a PostHog OAuth access token (`pha_…`), obtained through the same
  Authorization-Code + PKCE flow PostHog Code uses (same client IDs, scopes, and `/oauth/authorize`
  + `/oauth/token` endpoints from `@posthog/shared`), and
- lets pi own credential storage and refresh via its provider `oauth` hooks.

Because the token, OAuth client, and gateway product (`posthog_code`) are identical to PostHog Code,
gateway results are identical as well.

## Models

The model list is fetched from the gateway's `/{product}/v1/models` at startup, so harness exposes
whatever models the gateway currently serves — including OpenAI + codex (`gpt-5.5`, `gpt-5.4`,
`gpt-5.3-codex`, …) and GLM (`@cf/zai-org/glm-5.2`). Each model is routed by owner:

- Anthropic + Cloudflare/GLM models → pi's `anthropic-messages` API on `<gateway>/posthog_code`
- OpenAI + codex models → pi's `openai-responses` API on `<gateway>/posthog_code/v1`

If the fetch fails, returns no models, or `PI_OFFLINE` / `HARNESS_STATIC_MODELS` is set, a bundled
fallback list is used instead. Select any model with `--model posthog/<id>` (e.g.
`--model posthog/gpt-5.3-codex`, `--model "posthog/@cf/zai-org/glm-5.2"`).

## OAuth flow and region selection

`harness /login` runs an Authorization-Code + PKCE flow:

1. Determines the region: if `POSTHOG_REGION` (or an explicit `region` option) is set, it's used
   directly; otherwise the login prompts interactively for the region to use, offering `United
   States` and `European Union` (`dev` is not offered interactively — it's reachable only via
   `POSTHOG_REGION=dev`).
2. Generates a PKCE code verifier/challenge (`S256`) and a random `state`.
3. Starts a loopback HTTP server on `127.0.0.1:<port>` at `/callback`
   (port from `HARNESS_OAUTH_PORT`, default `8237`).
4. Builds the authorize URL for the resolved region with the same `client_id`, `scope`, and
   `required_access_level=project` as PostHog Code, and opens it in the default browser.
5. Waits for the browser redirect to hit `/callback` with `code` and matching `state` (rejects on an
   `error` param, missing `code`, a `state` mismatch, a 180s timeout, or cancellation).
6. Exchanges the code for tokens via `POST <cloudUrl>/oauth/token`.
7. Stores `OAuthCredentials` (`access`, `refresh`, `expires`, `region`) for pi to reuse and refresh.

Token refresh posts `grant_type=refresh_token` to the same token endpoint, using the region stored in
the credentials.

The provider also implements pi's `oauth.modifyModels` hook: whenever pi (re)loads models for this
provider — at startup with a previously-stored credential, and again immediately after a successful
login — it rewrites every model's `baseUrl` to match the region stored in that credential. This means
the region chosen at login always wins for routing requests, regardless of what region the provider
was initially registered with (e.g. before any login had happened).

## CLI

```bash
harness                       # interactive pi, with the posthog provider available
harness /login               # sign in via the PostHog OAuth flow; prompts for a region if none is set
harness -p "hi" --model posthog/claude-opus-4-8
```

`POSTHOG_REGION` (`us` / `eu` / `dev`) is optional: if set, it's used directly (skipping the region
prompt at login) and the interactive prompt is skipped entirely. If unset, the initial (pre-login)
provider registration defaults to `us` for model discovery, and `/login` prompts for the actual
region to authenticate against — which then takes over routing via `modifyModels` above. The OAuth
loopback callback port can be overridden with `HARNESS_OAUTH_PORT` (default `8237`).

## Spawn the CLI as a subprocess

```ts
import { spawnPiCli } from "@posthog/harness/spawn";

const child = spawnPiCli(["-p", "list the files", "--model", "posthog/claude-opus-4-8"], {
  env: { POSTHOG_REGION: "us" },
});
```

`spawnPiCli` launches the real `pi` binary with the PostHog provider loaded as an extension.

## SDK

```ts
import { createHarnessSession } from "@posthog/harness/session";

const session = await createHarnessSession({ region: "us", model: "claude-opus-4-8" });
session.subscribe((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});
await session.prompt("What files are in the current directory?");
```

The SDK reuses whatever credential `harness /login` stored, or accepts a static `apiKey` (a `pha_`
token) for headless use.

## Entry points

| Import | What |
| --- | --- |
| `@posthog/harness/cli` (bin `harness`) | pi CLI in-process with the PostHog provider |
| `@posthog/harness/spawn` | `spawnPiCli()` — spawn pi as a subprocess |
| `@posthog/harness/session` | `createHarnessSession()` — pi SDK `AgentSession` |
| `@posthog/harness/extensions` | extension registry |
| `@posthog/harness/extensions/hog-branding` | startup header rebrand — `createHogBrandingExtension()` |
| `@posthog/harness/extensions/posthog-provider` | default pi extension — `createPosthogProviderExtension()` |
| `@posthog/harness/extensions/posthog-provider/provider` | `POSTHOG_PROVIDER_NAME`, `buildPosthogProvider()`, `resolvePosthogProvider()` |
| `@posthog/harness/extensions/posthog-provider/oauth` | `loginPosthog()`, `refreshPosthog()`, `buildAuthorizeUrl()`, `getRedirectUri()`, `getCallbackPort()` |
| `@posthog/harness/extensions/posthog-provider/gateway` | `getGatewayBaseUrl()`, `getLlmGatewayUrl()`, `resolveRegion()`, `GATEWAY_PRODUCT` |
| `@posthog/harness/extensions/posthog-provider/models` | `resolveModelConfigs()`, `fallbackModelConfigs()`, `DEFAULT_MODEL`, `GatewayModel` |
