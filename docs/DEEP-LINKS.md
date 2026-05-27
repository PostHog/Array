# Deep Links

PostHog Code registers custom URL schemes so the desktop app can be opened with context from a browser, another app, or the shell. Opening a deep link focuses the app window and routes the URL to the matching handler.

## Schemes

| Environment | Scheme |
|---|---|
| Production | `posthog-code://` |
| Development | `posthog-code-dev://` |
| Legacy (production only) | `twig://`, `array://` |

All schemes route through the same dispatcher. The host portion of the URL selects the handler (`task`, `inbox`, `new`, `plan`, `issue`, `callback`, `integration`, `slack-integration`, `mcp-oauth-complete`).

If the app is not running, the OS launches it and the link is queued until the renderer is ready. If the app is minimised, it is restored and focused before the link is handled.

## User-facing links

These are the deep links you would share with someone or wire up from another tool.

### `posthog-code://new`

Open the new-task input, optionally pre-filled.

| Parameter | Required | Description |
|---|---|---|
| `prompt` | No* | Pre-filled prompt text |
| `repo` | No* | Cloud repository slug (e.g. `posthog/posthog`) |
| `mode` | No | Initial mode for the task (ignored unless it matches a known mode) |
| `model` | No | Initial model for the task (ignored unless it matches a known model) |

*At least one of `prompt` or `repo` must be present. `mode` and `model` alone are not enough to open a task with meaningful context.

```
posthog-code://new?prompt=Fix%20the%20login%20bug&repo=posthog%2Fposthog
posthog-code://new?repo=posthog%2Fposthog&model=claude-opus-4-7&mode=plan
```

### `posthog-code://plan`

Open the new-task input with a longer, base64-encoded plan as the initial prompt. Use this when the prompt is too large or contains characters that are awkward to URL-encode.

| Parameter | Required | Description |
|---|---|---|
| `plan` | Yes | Base64-encoded UTF-8 plan text. Standard or URL-safe alphabet, padding optional. |
| `repo` | No | Cloud repository slug |
| `mode` | No | Initial mode |
| `model` | No | Initial model |

```
posthog-code://plan?plan=SGVsbG8gV29ybGQ%3D&repo=posthog%2Fposthog
```

The link is rejected if `plan` is missing or is not valid base64.

Encoding: the plan must be base64-encoded UTF-8 (e.g. `Buffer.from(text, "utf-8").toString("base64")` in Node, or `btoa(unescape(encodeURIComponent(text)))` in the browser). Multibyte characters (emoji, non-English text) round-trip correctly only when the sender uses UTF-8.

Encoding tip: prefer URL-safe base64 (`-` and `_` instead of `+` and `/`, padding stripped). Standard base64 also works, but `+` must be percent-encoded as `%2B` or it will be decoded as a space by the URL parser. The decoder transparently handles both alphabets and missing padding.

### `posthog-code://issue`

Open the new-task input pre-filled with a GitHub issue's title, URL, and labels. The issue is fetched at link-open time, so the prompt always reflects the latest issue state.

| Parameter | Required | Description |
|---|---|---|
| `url` | Yes | Full GitHub issue URL (`https://github.com/<owner>/<repo>/issues/<number>`) |
| `repo` | No | Override the cloud repository slug (defaults to `<owner>/<repo>` parsed from `url`) |
| `mode` | No | Initial mode |
| `model` | No | Initial model |

```
posthog-code://issue?url=https%3A%2F%2Fgithub.com%2Fposthog%2Fposthog%2Fissues%2F12345
```

The link is rejected if `url` is missing, is not a `github.com` URL, or does not match `/<owner>/<repo>/issues/<number>`. If the issue cannot be fetched, a toast is shown and no navigation happens.

### `posthog-code://task/<taskId>[/run/<taskRunId>]`

Open an existing task. Optionally jump to a specific run.

| Segment | Required | Description |
|---|---|---|
| `<taskId>` | Yes | Task ID |
| `run/<taskRunId>` | No | Specific run to open |

```
posthog-code://task/abc123
posthog-code://task/abc123/run/xyz789
```

### `posthog-code://inbox/<reportId>`

Open a specific inbox report.

| Segment | Required | Description |
|---|---|---|
| `<reportId>` | Yes | Inbox report ID |

```
posthog-code://inbox/report_abc123
```

## OAuth callback links

These are issued by external services and consumed by the app. You should not need to construct them yourself, but they are documented for completeness.

### `posthog-code://callback`

PKCE OAuth callback for user sign-in. PostHog Cloud redirects to this URL after the user authorises in their browser.

| Parameter | Required | Description |
|---|---|---|
| `code` | Conditional | Authorisation code on success |
| `error` | Conditional | Error string on failure |

In development the same payload is delivered to `http://localhost:8237/callback` instead.

### `posthog-code://integration`

OAuth callback for the GitHub App installation flow. PostHog Cloud redirects to this URL after the user finishes the GitHub App install in their browser.

| Parameter | Description |
|---|---|
| `provider` | Integration provider, always `github` for this handler |
| `project_id` | PostHog project ID |
| `installation_id` | GitHub App installation ID |
| `status` | `success` or `error` |
| `error_code` | Error code on failure |
| `error_message` | Human-readable error message on failure |

The Slack integration uses its own [`slack-integration`](#posthog-codeslack-integration) handler; do not reuse this one for non-GitHub providers.

### `posthog-code://slack-integration`

OAuth callback for the Slack workspace install flow. PostHog Cloud redirects to this URL after the user authorises the PostHog Slack app and finishes the flow on the AccountConnected page.

| Parameter | Description |
|---|---|
| `project_id` | PostHog project ID (numeric) |
| `integration_id` | PostHog Slack integration row ID (numeric, set on success) |
| `status` | `success` or `error` (defaults to `success` if absent) |
| `error_code` | Error code on failure |
| `error_message` | Human-readable error message on failure |

The flow is started from the renderer by calling the `slackIntegration.startFlow` tRPC mutation, which opens the browser to PostHog Cloud's authorize endpoint. If the deep link is not received within five minutes, a `FlowTimedOut` event is emitted so the UI can surface a timeout state.

### `posthog-code://mcp-oauth-complete`

OAuth completion callback for MCP server integrations.

| Parameter | Description |
|---|---|
| `status` | `success` or `error` |
| `installation_id` | MCP server installation ID on success |
| `error` | Error string on failure |

In development the same payload is delivered to `http://localhost:8238/mcp-oauth-complete` instead.

## Implementation

| Handler | Source |
|---|---|
| Dispatcher | [apps/code/src/main/services/deep-link/service.ts](../apps/code/src/main/services/deep-link/service.ts) |
| `task` | [apps/code/src/main/services/task-link/service.ts](../apps/code/src/main/services/task-link/service.ts) |
| `inbox` | [apps/code/src/main/services/inbox-link/service.ts](../apps/code/src/main/services/inbox-link/service.ts) |
| `new`, `plan`, `issue` | [apps/code/src/main/services/new-task-link/service.ts](../apps/code/src/main/services/new-task-link/service.ts) |
| `callback` | [apps/code/src/main/services/oauth/service.ts](../apps/code/src/main/services/oauth/service.ts) |
| `integration` | [apps/code/src/main/services/github-integration/service.ts](../apps/code/src/main/services/github-integration/service.ts) |
| `slack-integration` | [apps/code/src/main/services/slack-integration/service.ts](../apps/code/src/main/services/slack-integration/service.ts) |
| `mcp-oauth-complete` | [apps/code/src/main/services/mcp-callback/service.ts](../apps/code/src/main/services/mcp-callback/service.ts) |
| Scheme constants | [apps/code/src/shared/deeplink.ts](../apps/code/src/shared/deeplink.ts) |

To add a new deep link, register a handler with `DeepLinkService.registerHandler(key, handler)` and route renderer-side events through the [`deepLinkRouter`](../apps/code/src/main/trpc/routers/deep-link.ts) tRPC router.
