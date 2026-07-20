//! JSON-RPC transport for the codex app-server.
//!
//! Port of `app-server-client.ts`: newline-delimited JSON that omits the
//! `"jsonrpc": "2.0"` header. Ids are `string | number` per the codex schema;
//! ours are numeric from 1. Server-initiated requests (approvals) dispatch to
//! the handler concurrently — an approval blocked on a relayed permission
//! must not stall the notification stream behind it.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, oneshot};

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct RpcFailure(pub String);

/// Handler for server-initiated requests; the returned value is sent back as
/// the JSON-RPC result (errors become `{code: -32000, message}`).
#[async_trait::async_trait]
pub trait ServerRequestHandler: Send + Sync + 'static {
    async fn handle_server_request(&self, method: &str, params: Value) -> Result<Value, String>;
}

type Pending = Arc<Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

/// Writer handle + request correlation for the app-server process.
#[derive(Clone)]
pub struct CodexRpc {
    out: mpsc::UnboundedSender<String>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
}

impl CodexRpc {
    /// Spawn reader/writer tasks over the app-server's stdio. Notifications
    /// are delivered in order on the returned receiver as `(method, params)`;
    /// the channel closes when the process exits (in-flight requests fail).
    pub fn spawn<R, W>(
        read: R,
        write: W,
        handler: Arc<dyn ServerRequestHandler>,
    ) -> (Self, mpsc::UnboundedReceiver<(String, Value)>)
    where
        R: tokio::io::AsyncRead + Unpin + Send + 'static,
        W: tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
        let (notif_tx, notif_rx) = mpsc::unbounded_channel::<(String, Value)>();
        let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

        let rpc = CodexRpc {
            out: out_tx,
            pending: Arc::clone(&pending),
            next_id: Arc::new(AtomicU64::new(1)),
        };

        tokio::spawn(async move {
            let mut write = write;
            while let Some(line) = out_rx.recv().await {
                if write.write_all(line.as_bytes()).await.is_err() {
                    break;
                }
                if write.write_all(b"\n").await.is_err() {
                    break;
                }
                if write.flush().await.is_err() {
                    break;
                }
            }
        });

        let reader_rpc = rpc.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(read).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        let trimmed = line.trim();
                        if trimmed.is_empty() {
                            continue;
                        }
                        let Ok(message) = serde_json::from_str::<Value>(trimmed) else {
                            tracing::debug!("Ignoring non-JSON app-server line");
                            continue;
                        };
                        reader_rpc.dispatch(message, &handler, &notif_tx);
                    }
                    Ok(None) => break,
                    Err(err) => {
                        tracing::debug!(error = %err, "app-server read failed");
                        break;
                    }
                }
            }
            // Stream ended (process exited): fail in-flight calls so the turn
            // doesn't hang; dropping notif_tx signals EOF to the pump.
            let mut pending = pending.lock().expect("pending lock");
            for (_, tx) in pending.drain() {
                let _ = tx.send(Err("codex app-server stream closed".to_string()));
            }
        });

        (rpc, notif_rx)
    }

    fn dispatch(
        &self,
        message: Value,
        handler: &Arc<dyn ServerRequestHandler>,
        notif_tx: &mpsc::UnboundedSender<(String, Value)>,
    ) {
        let method = message.get("method").and_then(Value::as_str);
        // Discriminate on id presence, not type — RequestId is string|number,
        // so a string-id server request must still be answered.
        let has_id = message.get("id").map(|id| !id.is_null()).unwrap_or(false);

        match (method, has_id) {
            (Some(method), true) => {
                let rpc = self.clone();
                let handler = Arc::clone(handler);
                let method = method.to_string();
                let id = message.get("id").cloned().unwrap_or(Value::Null);
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                tokio::spawn(async move {
                    let response = match handler.handle_server_request(&method, params).await {
                        Ok(result) => json!({ "id": id, "result": result }),
                        Err(error) => json!({
                            "id": id,
                            "error": { "code": -32000, "message": error },
                        }),
                    };
                    rpc.write_raw(&response);
                });
            }
            (Some(method), false) => {
                let params = message.get("params").cloned().unwrap_or(Value::Null);
                let _ = notif_tx.send((method.to_string(), params));
            }
            (None, true) => {
                let Some(id) = message.get("id").and_then(Value::as_u64) else {
                    tracing::debug!("Response with non-numeric id");
                    return;
                };
                let tx = self.pending.lock().expect("pending lock").remove(&id);
                let Some(tx) = tx else {
                    tracing::debug!(id, "Response for unknown request id");
                    return;
                };
                let result = if let Some(error) = message.get("error") {
                    Err(error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("app-server request failed")
                        .to_string())
                } else {
                    Ok(message.get("result").cloned().unwrap_or(Value::Null))
                };
                let _ = tx.send(result);
            }
            (None, false) => {
                tracing::debug!("app-server line is neither request, response, nor notification");
            }
        }
    }

    fn write_raw(&self, message: &Value) {
        let _ = self.out.send(message.to_string());
    }

    /// Send a request and await its result.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, RpcFailure> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().expect("pending lock").insert(id, tx);
        self.write_raw(&json!({ "id": id, "method": method, "params": params }));
        match rx.await {
            Ok(Ok(result)) => Ok(result),
            Ok(Err(err)) => Err(RpcFailure(err)),
            Err(_) => Err(RpcFailure("codex app-server stream closed".to_string())),
        }
    }

    /// Send a notification (no response expected).
    pub fn notify(&self, method: &str, params: Value) {
        self.write_raw(&json!({ "method": method, "params": params }));
    }
}
