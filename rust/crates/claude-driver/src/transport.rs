//! Claude CLI stream-json transport and control protocol.
//!
//! The CLI's stdout carries ndjson: SDK messages (`system`, `assistant`,
//! `user`, `result`, `stream_event`, ...) interleaved with control traffic:
//!
//! - `{"type":"control_request","request_id","request":{subtype,...}}` — the
//!   CLI asking us (can_use_tool, hook_callback, mcp_message, ...)
//! - `{"type":"control_response","response":{subtype:"success"|"error",
//!   "request_id",...}}` — replies to our own requests
//! - `{"type":"control_cancel_request","request_id"}` and `keep_alive`
//!
//! We write user messages and control requests (initialize, interrupt,
//! set_permission_mode, set_model) to stdin. Mirrors the SDK's `Query` class.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct TransportError(pub String);

/// Handler for control requests initiated by the CLI.
#[async_trait::async_trait]
pub trait ControlHandler: Send + Sync + 'static {
    /// Returns the `response` payload for a success control_response, or an
    /// error string for an error control_response.
    async fn handle_control_request(&self, request: Value) -> Result<Value, String>;
}

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Result<Value, String>>>>>;

/// Writer handle + request correlation for the CLI process.
#[derive(Clone)]
pub struct CliTransport {
    out: mpsc::UnboundedSender<String>,
    pending: Pending,
    counter: Arc<AtomicU64>,
}

impl CliTransport {
    /// A transport wired to nothing — a construction placeholder whose writes
    /// go nowhere and whose control requests fail immediately. Callers swap in
    /// a real transport before any traffic flows.
    pub fn detached() -> (Self, mpsc::UnboundedReceiver<Value>) {
        let (out_tx, _out_rx) = mpsc::unbounded_channel();
        let (_msg_tx, msg_rx) = mpsc::unbounded_channel();
        (
            CliTransport {
                out: out_tx,
                pending: Arc::new(Mutex::new(HashMap::new())),
                counter: Arc::new(AtomicU64::new(0)),
            },
            msg_rx,
        )
    }

    /// Spawn reader/writer tasks over the CLI's stdio. SDK messages (anything
    /// that isn't control traffic) are delivered in order on the returned
    /// receiver; the channel closes when the CLI exits.
    pub fn spawn(
        stdin: ChildStdin,
        stdout: ChildStdout,
        handler: Arc<dyn ControlHandler>,
    ) -> (Self, mpsc::UnboundedReceiver<Value>) {
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let (msg_tx, msg_rx) = mpsc::unbounded_channel::<Value>();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

        let transport = CliTransport {
            out: out_tx,
            pending: Arc::clone(&pending),
            counter: Arc::new(AtomicU64::new(0)),
        };

        tokio::spawn(async move {
            let mut stdin = stdin;
            while let Some(line) = out_rx.recv().await {
                if stdin.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if stdin.write_all(b"\n").await.is_err() {
                    break;
                }
                if stdin.flush().await.is_err() {
                    break;
                }
            }
        });

        let reader_transport = transport.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
                            tracing::debug!("Non-JSON CLI stdout line");
                            continue;
                        };
                        reader_transport.dispatch(message, &handler, &msg_tx);
                    }
                    Ok(None) => break,
                    Err(err) => {
                        tracing::debug!(error = %err, "CLI stdout read failed");
                        break;
                    }
                }
            }
            // Fail in-flight control requests so callers don't hang on a
            // dead CLI; dropping msg_tx signals EOF to the message loop.
            let mut pending = pending.lock().expect("pending lock");
            for (_, tx) in pending.drain() {
                let _ = tx.send(Err("Claude Code process exited".to_string()));
            }
        });

        (transport, msg_rx)
    }

    fn dispatch(
        &self,
        message: Value,
        handler: &Arc<dyn ControlHandler>,
        msg_tx: &mpsc::UnboundedSender<Value>,
    ) {
        match message.get("type").and_then(Value::as_str) {
            Some("control_response") => {
                let Some(response) = message.get("response") else {
                    return;
                };
                let Some(request_id) = response.get("request_id").and_then(Value::as_str) else {
                    return;
                };
                let tx = self
                    .pending
                    .lock()
                    .expect("pending lock")
                    .remove(request_id);
                let Some(tx) = tx else { return };
                let result = if response.get("subtype").and_then(Value::as_str) == Some("success") {
                    Ok(response.get("response").cloned().unwrap_or(Value::Null))
                } else {
                    Err(response
                        .get("error")
                        .and_then(Value::as_str)
                        .unwrap_or("control request failed")
                        .to_string())
                };
                let _ = tx.send(result);
            }
            Some("control_request") => {
                // Answer concurrently: a can_use_tool blocked on a relayed
                // permission must not stall session updates behind it.
                let transport = self.clone();
                let handler = Arc::clone(handler);
                tokio::spawn(async move {
                    let request_id = message.get("request_id").cloned().unwrap_or(Value::Null);
                    let request = message.get("request").cloned().unwrap_or(Value::Null);
                    let response = match handler.handle_control_request(request).await {
                        Ok(payload) => json!({
                            "type": "control_response",
                            "response": {
                                "subtype": "success",
                                "request_id": request_id,
                                "response": payload,
                            },
                        }),
                        Err(error) => json!({
                            "type": "control_response",
                            "response": {
                                "subtype": "error",
                                "request_id": request_id,
                                "error": error,
                            },
                        }),
                    };
                    transport.write_value(&response);
                });
            }
            Some("control_cancel_request") | Some("keep_alive") => {}
            _ => {
                let _ = msg_tx.send(message);
            }
        }
    }

    pub fn write_value(&self, value: &Value) {
        let _ = self.out.send(value.to_string());
    }

    /// Send a control request to the CLI and await its response payload.
    pub async fn control_request(&self, request: Value) -> Result<Value, TransportError> {
        let id = format!("req_{}", self.counter.fetch_add(1, Ordering::Relaxed));
        let (tx, rx) = oneshot::channel();
        self.pending
            .lock()
            .expect("pending lock")
            .insert(id.clone(), tx);

        self.write_value(&json!({
            "type": "control_request",
            "request_id": id,
            "request": request,
        }));

        match rx.await {
            Ok(Ok(payload)) => Ok(payload),
            Ok(Err(err)) => Err(TransportError(err)),
            Err(_) => Err(TransportError("Claude Code process exited".to_string())),
        }
    }
}
