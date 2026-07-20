//! LLM gateway URL resolution and `x-posthog-property-*` header building.
//!
//! Ports `packages/agent/src/utils/gateway.ts` and
//! `packages/shared/src/posthog-property-headers.ts`.

/// Gateway product slug (`GatewayProduct` in gateway.ts).
pub fn resolve_gateway_product(is_internal: bool, origin_product: Option<&str>) -> &'static str {
    match origin_product {
        Some("slack") => "slack_app",
        Some("posthog_ai") => "posthog_ai",
        Some("signal_report") | Some("signals_scout") => "signals",
        Some("support_reply") => "conversations",
        _ if is_internal => "background_agents",
        _ => "posthog_code",
    }
}

fn gateway_base_url(posthog_host: &str) -> String {
    let host = posthog_host
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let hostname = host.split([':', '/']).next().unwrap_or(host);
    let protocol = if posthog_host.starts_with("http://") {
        "http"
    } else {
        "https"
    };

    match hostname {
        "localhost" | "127.0.0.1" => format!("{protocol}://localhost:3308"),
        "host.docker.internal" => format!("{protocol}://host.docker.internal:3308"),
        // The hosted dev environment runs its own LLM gateway with its own
        // auth DB; a dev-minted token can't route to the US gateway.
        "app.dev.posthog.dev" => "https://gateway.dev.posthog.dev".to_string(),
        "eu.posthog.com" => "https://gateway.eu.posthog.com".to_string(),
        _ => "https://gateway.us.posthog.com".to_string(),
    }
}

/// Resolve the gateway URL, preferring an explicit `LLM_GATEWAY_URL` override
/// treated as a *base* URL — the product slug is always appended.
pub fn resolve_llm_gateway_url(env_url: Option<&str>, posthog_host: &str, product: &str) -> String {
    match env_url {
        Some(url) if !url.is_empty() => {
            format!("{}/{product}", url.trim_end_matches('/'))
        }
        _ => format!("{}/{product}", gateway_base_url(posthog_host)),
    }
}

/// Make a value safe to embed in an HTTP header value: collapse newlines to
/// spaces, drop bytes outside the valid header range (control chars, code
/// points above latin1).
fn sanitize_header_value(value: &str) -> String {
    let collapsed: String = value
        .chars()
        .map(|c| if c == '\r' || c == '\n' { ' ' } else { c })
        .collect();
    collapsed
        .chars()
        .filter(|&c| {
            let code = c as u32;
            (0x20..=0x7e).contains(&code) || (0x80..=0xff).contains(&code)
        })
        .collect()
}

/// Newline-joined `x-posthog-property-<key>: <value>` lines — the format
/// `ANTHROPIC_CUSTOM_HEADERS` expects. Skips empty values.
pub fn build_gateway_property_header_lines(properties: &[(&str, Option<String>)]) -> String {
    properties
        .iter()
        .filter_map(|(key, value)| {
            let value = value.as_ref()?;
            Some(format!(
                "x-posthog-property-{key}: {}",
                sanitize_header_value(value)
            ))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Task-scoped gateway configuration handed to the agent adapter
/// (`GatewayEnv` in `adapters/claude/session/options.ts`).
#[derive(Debug, Clone, serde::Serialize)]
pub struct GatewayEnv {
    #[serde(rename = "anthropicBaseUrl")]
    pub anthropic_base_url: String,
    #[serde(rename = "anthropicAuthToken")]
    pub anthropic_auth_token: String,
    #[serde(rename = "openaiBaseUrl")]
    pub openai_base_url: String,
    #[serde(rename = "openaiApiKey")]
    pub openai_api_key: String,
    #[serde(rename = "anthropicCustomHeaders")]
    pub anthropic_custom_headers: String,
    #[serde(rename = "posthogProjectId")]
    pub posthog_project_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_products() {
        assert_eq!(resolve_gateway_product(false, Some("slack")), "slack_app");
        assert_eq!(
            resolve_gateway_product(false, Some("signal_report")),
            "signals"
        );
        assert_eq!(resolve_gateway_product(true, None), "background_agents");
        assert_eq!(resolve_gateway_product(false, None), "posthog_code");
    }

    #[test]
    fn resolves_gateway_urls() {
        assert_eq!(
            resolve_llm_gateway_url(None, "https://us.posthog.com", "posthog_code"),
            "https://gateway.us.posthog.com/posthog_code"
        );
        assert_eq!(
            resolve_llm_gateway_url(None, "https://eu.posthog.com", "slack_app"),
            "https://gateway.eu.posthog.com/slack_app"
        );
        assert_eq!(
            resolve_llm_gateway_url(
                Some("https://gateway.dev.posthog.dev/"),
                "https://x",
                "signals"
            ),
            "https://gateway.dev.posthog.dev/signals"
        );
        assert_eq!(
            resolve_llm_gateway_url(None, "http://localhost:8010", "posthog_code"),
            "http://localhost:3308/posthog_code"
        );
    }

    #[test]
    fn builds_sanitized_property_header_lines() {
        let lines = build_gateway_property_header_lines(&[
            ("task_id", Some("task_1".to_string())),
            ("skipped", None),
            ("task_title", Some("multi\nline ✨ title".to_string())),
        ]);
        assert_eq!(
            lines,
            "x-posthog-property-task_id: task_1\nx-posthog-property-task_title: multi line  title"
        );
    }
}
