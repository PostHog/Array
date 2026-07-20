//! codex app-server process spawn: argument construction, environment, and
//! binary resolution. Port of `spawn.ts` (`buildAppServerArgs` /
//! `spawnCodexAppServerProcess`) and `binary-path.ts`, for the sandbox
//! layout (launch cwd `/scripts`, binary vendored by `@openai/codex`).

use std::path::PathBuf;
use std::process::Stdio;

use tokio::process::{Child, ChildStdin, ChildStdout, Command};

#[derive(Debug, Clone, Default)]
pub struct AppServerOptions {
    pub binary_path: PathBuf,
    pub cwd: String,
    /// Gateway base URL; configures the `posthog` model provider when set.
    pub api_base_url: Option<String>,
    /// Gateway key, exported as `POSTHOG_GATEWAY_API_KEY`.
    pub api_key: Option<String>,
    /// Private CODEX_HOME for this run; without it codex uses ~/.codex.
    pub codex_home: Option<String>,
}

/// Resolve the native codex binary: `POSTHOG_CODEX_BINARY_PATH` env override,
/// else the binary vendored by `@openai/codex`'s platform sub-package under
/// the working directory's node_modules (the sandbox installs `@posthog/agent`
/// with its `@openai/codex` dependency into /scripts).
pub fn resolve_codex_binary() -> Option<PathBuf> {
    if let Ok(explicit) = std::env::var("POSTHOG_CODEX_BINARY_PATH") {
        if !explicit.is_empty() {
            return Some(PathBuf::from(explicit));
        }
    }
    let (pkg, triple) = if cfg!(target_arch = "aarch64") {
        ("@openai/codex-linux-arm64", "aarch64-unknown-linux-musl")
    } else {
        ("@openai/codex-linux-x64", "x86_64-unknown-linux-musl")
    };
    let vendored = PathBuf::from(format!("./node_modules/{pkg}/vendor/{triple}/bin/codex"));
    if vendored.exists() {
        return Some(vendored);
    }
    None
}

/// Port of `buildAppServerArgs` for the cloud path. The macOS Seatbelt branch
/// and the ambient-config MCP disabling are omitted: the driver only runs in
/// linux sandboxes, where there is no OS sandbox launcher (the enclosing
/// docker/Modal sandbox isolates instead) and CODEX_HOME is image-controlled.
pub fn build_app_server_args(options: &AppServerOptions) -> Vec<String> {
    let mut args: Vec<String> = vec!["app-server".into()];

    let mut push_config = |value: &str| {
        args.push("-c".into());
        args.push(value.to_string());
    };

    push_config("features.remote_models=false");
    // Ambient plugins inject MCP servers and session-start hooks into PostHog
    // sessions; threads only get the MCP servers PostHog injects.
    push_config("features.plugins=false");
    // Model auth is injected via POSTHOG_GATEWAY_API_KEY, so codex's own
    // credential stores are unused: keep them on plain files, never a keychain.
    push_config("cli_auth_credentials_store=\"file\"");
    push_config("mcp_oauth_credentials_store=\"file\"");
    // No sandbox launcher on linux (a non-danger policy would panic); the
    // enclosing docker/Modal sandbox isolates instead.
    push_config("sandbox_mode=\"danger-full-access\"");

    if let Some(base_url) = options.api_base_url.as_deref().filter(|u| !u.is_empty()) {
        push_config("model_provider=\"posthog\"");
        push_config("model_providers.posthog.name=\"PostHog Gateway\"");
        push_config(&format!("model_providers.posthog.base_url=\"{base_url}\""));
        push_config("model_providers.posthog.wire_api=\"responses\"");
        push_config("model_providers.posthog.env_key=\"POSTHOG_GATEWAY_API_KEY\"");
    }

    args
}

pub struct SpawnedAppServer {
    pub child: Child,
    pub stdin: ChildStdin,
    pub stdout: ChildStdout,
}

pub fn spawn_app_server(options: &AppServerOptions) -> std::io::Result<SpawnedAppServer> {
    let args = build_app_server_args(options);
    let mut command = Command::new(&options.binary_path);
    command.args(&args);
    command.current_dir(&options.cwd);
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    // codex diagnostics belong in /tmp/agent-server.log with ours.
    command.stderr(Stdio::inherit());
    command.kill_on_drop(true);

    if let Some(api_key) = options.api_key.as_deref().filter(|k| !k.is_empty()) {
        command.env("POSTHOG_GATEWAY_API_KEY", api_key);
    }
    if let Some(codex_home) = options.codex_home.as_deref().filter(|h| !h.is_empty()) {
        command.env("CODEX_HOME", codex_home);
    }

    let mut child = command.spawn()?;
    let stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    tracing::info!(
        binary = %options.binary_path.display(),
        pid = child.id(),
        "Spawned codex app-server"
    );
    Ok(SpawnedAppServer {
        child,
        stdin,
        stdout,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn args_pin_provider_and_credential_stores() {
        let options = AppServerOptions {
            binary_path: PathBuf::from("/usr/bin/codex"),
            cwd: "/tmp".into(),
            api_base_url: Some("https://gateway.example/v1".into()),
            api_key: Some("k".into()),
            codex_home: None,
        };
        let args = build_app_server_args(&options);
        assert_eq!(args[0], "app-server");
        let joined = args.join(" ");
        assert!(joined.contains("features.remote_models=false"));
        assert!(joined.contains("features.plugins=false"));
        assert!(joined.contains("cli_auth_credentials_store=\"file\""));
        assert!(joined.contains("sandbox_mode=\"danger-full-access\""));
        assert!(joined.contains("model_provider=\"posthog\""));
        assert!(joined.contains("model_providers.posthog.base_url=\"https://gateway.example/v1\""));
        assert!(joined.contains("model_providers.posthog.wire_api=\"responses\""));
        assert!(joined.contains("model_providers.posthog.env_key=\"POSTHOG_GATEWAY_API_KEY\""));
    }

    #[test]
    fn args_skip_provider_without_base_url() {
        let args = build_app_server_args(&AppServerOptions {
            binary_path: PathBuf::from("/usr/bin/codex"),
            cwd: "/tmp".into(),
            ..Default::default()
        });
        assert!(!args.join(" ").contains("model_provider"));
    }
}
