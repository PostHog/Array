//! HTTP surface: `GET /health`, `GET /events` (SSE), `POST /command`.
//!
//! Response shapes, status codes, and error bodies mirror `createApp()` in
//! `agent-server.ts` — Django (`send_agent_command`, `wait_for_health_check`)
//! and the event relay consume these exact shapes.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio_stream::wrappers::UnboundedReceiverStream;
use tokio_stream::StreamExt;

use crate::bus::SSE_KEEPALIVE_FRAME;
use crate::command::{parse_json_rpc, validate_command_params};
use crate::jwt::{validate_jwt, JwtPayload, JwtValidationError};
use crate::server::AgentServer;

pub const SSE_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(25);

pub fn build_router(server: Arc<AgentServer>) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/events", get(events))
        .route("/command", post(command))
        .fallback(not_found)
        .with_state(server)
}

async fn health(State(server): State<Arc<AgentServer>>) -> Json<Value> {
    Json(server.health())
}

fn authenticate_request(
    server: &AgentServer,
    headers: &HeaderMap,
) -> Result<JwtPayload, JwtValidationError> {
    // Always require JWT validation - never trust unverified headers.
    let auth_header = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if !auth_header.starts_with("Bearer ") {
        return Err(JwtValidationError {
            message: "Missing authorization header".to_string(),
            code: crate::jwt::JwtErrorCode::InvalidToken,
        });
    }
    validate_jwt(&auth_header[7..], &server.config.jwt_public_key)
}

async fn events(State(server): State<Arc<AgentServer>>, headers: HeaderMap) -> Response {
    let payload = match authenticate_request(&server, &headers) {
        Ok(payload) => payload,
        Err(err) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": err.message, "code": err.code.as_str() })),
            )
                .into_response()
        }
    };

    let (tx, rx) = tokio::sync::mpsc::unbounded_channel::<String>();

    // Keepalive comments flow through the same channel as data frames; the
    // task ends when the client disconnects (send fails).
    {
        let tx = tx.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(SSE_KEEPALIVE_INTERVAL);
            interval.tick().await; // first tick fires immediately; skip it
            loop {
                interval.tick().await;
                if tx.send(SSE_KEEPALIVE_FRAME.to_string()).is_err() {
                    break;
                }
            }
        });
    }

    // Attach (or initialize) the session, then confirm the connection. Runs
    // after the response streaming has started, matching the TS handler.
    {
        let server = Arc::clone(&server);
        let tx = tx.clone();
        tokio::spawn(async move {
            let session = server.session().await;
            let attached = match &session {
                Some(session) if session.payload.run_id == payload.run_id => {
                    session
                        .shared
                        .has_desktop_connected
                        .store(true, std::sync::atomic::Ordering::SeqCst);
                    server.bus.attach_sse(tx.clone());
                    true
                }
                _ => match server
                    .initialize_session(payload.clone(), Some(tx.clone()))
                    .await
                {
                    Ok(()) => true,
                    Err(err) => {
                        tracing::error!(error = %err, "Session initialization from /events failed");
                        false
                    }
                },
            };
            if attached {
                server
                    .bus
                    .send_sse_only(&json!({ "type": "connected", "run_id": payload.run_id }));
            }
        });
    }

    let stream = UnboundedReceiverStream::new(rx)
        .map(|frame| Ok::<_, Infallible>(bytes::Bytes::from(frame)));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::CONNECTION, "keep-alive")
        .body(Body::from_stream(stream))
        .expect("valid SSE response")
}

async fn command(
    State(server): State<Arc<AgentServer>>,
    headers: HeaderMap,
    body: String,
) -> Response {
    let payload = match authenticate_request(&server, &headers) {
        Ok(payload) => payload,
        Err(err) => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({ "error": err.message })),
            )
                .into_response()
        }
    };

    let session = server.session().await;
    let session_matches = session
        .as_ref()
        .map(|s| s.payload.run_id == payload.run_id)
        .unwrap_or(false);
    if !session_matches {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "No active session for this run" })),
        )
            .into_response();
    }

    let raw_body: Option<Value> = serde_json::from_str(&body).ok();
    let Some(command) = raw_body.as_ref().and_then(parse_json_rpc) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({ "error": "Invalid JSON-RPC request" })),
        )
            .into_response();
    };

    let method = match validate_command_params(&command.method, &command.params) {
        Ok(method) => method,
        Err(message) => {
            return Json(with_id(
                json!({
                    "jsonrpc": "2.0",
                    "error": { "code": -32602, "message": message },
                }),
                &command.id,
            ))
            .into_response();
        }
    };

    match server.execute_command(method, command.params.clone()).await {
        Ok(result) => Json(with_id(
            json!({ "jsonrpc": "2.0", "result": result }),
            &command.id,
        ))
        .into_response(),
        Err(message) => Json(with_id(
            json!({
                "jsonrpc": "2.0",
                "error": { "code": -32000, "message": message },
            }),
            &command.id,
        ))
        .into_response(),
    }
}

fn with_id(mut response: Value, id: &Option<Value>) -> Value {
    if let Some(id) = id {
        response["id"] = id.clone();
    }
    response
}

async fn not_found() -> Response {
    (StatusCode::NOT_FOUND, Json(json!({ "error": "Not found" }))).into_response()
}
