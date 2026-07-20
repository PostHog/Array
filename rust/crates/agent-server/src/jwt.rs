//! RS256 JWT validation for sandbox connections.
//!
//! Mirrors `packages/agent/src/server/jwt.ts`: same audience, payload schema,
//! and error codes (`invalid_token` / `expired` / `invalid_signature` /
//! `server_error`) — the HTTP layer serializes these codes into 401 bodies
//! that clients switch on.

use jsonwebtoken::{decode, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};

pub const SANDBOX_CONNECTION_AUDIENCE: &str = "posthog:sandbox_connection";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct JwtPayload {
    pub run_id: String,
    pub task_id: String,
    pub team_id: i64,
    pub user_id: i64,
    pub distinct_id: String,
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_mode() -> String {
    "interactive".to_string()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JwtErrorCode {
    InvalidToken,
    Expired,
    InvalidSignature,
    ServerError,
}

impl JwtErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            JwtErrorCode::InvalidToken => "invalid_token",
            JwtErrorCode::Expired => "expired",
            JwtErrorCode::InvalidSignature => "invalid_signature",
            JwtErrorCode::ServerError => "server_error",
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct JwtValidationError {
    pub message: String,
    pub code: JwtErrorCode,
}

impl JwtValidationError {
    fn new(message: impl Into<String>, code: JwtErrorCode) -> Self {
        Self {
            message: message.into(),
            code,
        }
    }
}

/// Raw claims: payload fields plus registered claims we validate.
#[derive(Debug, Deserialize)]
struct Claims {
    run_id: String,
    task_id: String,
    team_id: i64,
    user_id: i64,
    distinct_id: String,
    mode: Option<String>,
}

pub fn validate_jwt(token: &str, public_key_pem: &str) -> Result<JwtPayload, JwtValidationError> {
    let key = DecodingKey::from_rsa_pem(public_key_pem.as_bytes())
        .map_err(|_| JwtValidationError::new("Invalid token", JwtErrorCode::InvalidToken))?;

    let mut validation = Validation::new(Algorithm::RS256);
    validation.set_audience(&[SANDBOX_CONNECTION_AUDIENCE]);
    validation.validate_exp = true;

    let data = decode::<Claims>(token, &key, &validation).map_err(|err| {
        use jsonwebtoken::errors::ErrorKind;
        match err.kind() {
            ErrorKind::ExpiredSignature => {
                JwtValidationError::new("Token expired", JwtErrorCode::Expired)
            }
            ErrorKind::InvalidSignature => {
                JwtValidationError::new("Invalid signature", JwtErrorCode::InvalidSignature)
            }
            // Missing payload fields surface as JSON errors — match the TS
            // path that reports a schema failure as invalid_token.
            ErrorKind::Json(json_err) => JwtValidationError::new(
                format!("Missing required fields: {json_err}"),
                JwtErrorCode::InvalidToken,
            ),
            _ => JwtValidationError::new("Invalid signature", JwtErrorCode::InvalidSignature),
        }
    })?;

    let claims = data.claims;
    let mode = match claims.mode.as_deref() {
        None => "interactive".to_string(),
        Some("interactive") => "interactive".to_string(),
        Some("background") => "background".to_string(),
        Some(other) => {
            return Err(JwtValidationError::new(
                format!("Missing required fields: invalid mode {other:?}"),
                JwtErrorCode::InvalidToken,
            ))
        }
    };

    Ok(JwtPayload {
        run_id: claims.run_id,
        task_id: claims.task_id,
        team_id: claims.team_id,
        user_id: claims.user_id,
        distinct_id: claims.distinct_id,
        mode,
    })
}
